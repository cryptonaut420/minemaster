import { useEffect, useRef, useState } from "react";
import api from "../services/api";
import {
  controlUnavailable,
  quickScope,
  controlOutcome,
} from "../utils/rigControls";
import { useNotifications } from "../components/Notifications";

const active = (c) =>
  ["queued", "sent", "received", "running"].includes(c?.status);
const message = (e) => e.response?.data?.error || e.message || "Request failed";
export default function useQuickControls(onChanged) {
  const notify = useNotifications();
  const [receipts, setReceipts] = useState({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const jobs = useRef([]),
    operations = useRef(new Map()),
    current = useRef({}),
    writes = useRef(new Set()),
    generation = useRef(0);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  function record(rows) {
    for (const row of rows) {
      const op = operations.current.get(row.operation);
      if (!op) continue;
      op.rows.set(row.minerId, row);
      const outcome =
        op.rows.size === op.count &&
        controlOutcome(op.action, [...op.rows.values()], op.skipped);
      if (outcome) {
        notify.updateToast(
          op.toast,
          outcome.message,
          outcome.type,
          outcome.type === "error" ? 10000 : 5000,
        );
        operations.current.delete(row.operation);
      }
    }
    setReceipts((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        // An old start receipt must never replace a newer Pause receipt.
        if (current.current[row.minerId] === row.operation)
          next[row.minerId] = row;
      }
      return next;
    });
  }
  useEffect(() => {
    let disposed = false,
      polling = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        for (const job of [...jobs.current]) {
          try {
            const { data } = await api.get("/v1/commands", {
              params: { batchId: job.batchId, limit: 500 },
            });
            if (disposed) return;
            const rows = job.results.map((row) => ({
              ...row,
              command:
                data.data.find((c) => c.id === row.command?.id) || row.command,
            }));
            record(rows);
            job.results = rows;
            if (!rows.some((r) => active(r.command))) {
              jobs.current = jobs.current.filter((j) => j !== job);
              changed.current();
            }
          } catch (e) {
            if (!disposed)
              setNotice(
                `Cannot confirm command results: ${message(e)}. See Activity before retrying.`,
              );
          }
        }
      } finally {
        polling = false;
      }
    }, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  async function run(action, rigs) {
    const operation = crypto.randomUUID();
    // Pause supersedes any fleet Play still collecting or dispatching targets.
    if (action === "stop") generation.current++;
    const own = generation.current;
    setBusy(true);
    setNotice("");
    const toast = notify.info(
      `${action === "start" ? "Starting" : "Pausing"} ${rigs?.length === 1 ? rigs[0].name : rigs ? `${rigs.length} selected rigs` : "the fleet"}…`,
      10000,
    );
    try {
      if (action === "stop") await Promise.allSettled([...writes.current]);
      let targets = rigs;
      // Selection can span pages and outlive a prior command. Refresh Play's
      // observed state before choosing scope; never restart a running process.
      if (action === "start" && rigs?.length === 1) {
        const { data } = await api.get(`/v1/rigs/${rigs[0].id}`);
        targets = [data.data];
      } else if (!targets || (action === "start" && rigs.length > 1)) {
        targets = [];
        let cursor;
        do {
          const { data } = await api.get("/v1/rigs", {
            params: { sort: "id", limit: 500, cursor },
          });
          targets.push(...data.data);
          cursor = data.nextCursor;
        } while (cursor && own === generation.current);
        if (rigs) {
          const ids = new Set(rigs.map((r) => r.id));
          targets = targets.filter((r) => ids.has(r.id));
        }
      }
      if (own !== generation.current) {
        notify.updateToast(toast, "Play canceled by a newer Pause.", "info");
        return;
      }
      targets = [...new Map(targets.map((r) => [r.id, r])).values()];
      const eligible = targets.filter(
        (r) => !controlUnavailable(r) && quickScope(r, action),
      );
      const skipped = (rigs?.length || targets.length) - eligible.length;
      if (!eligible.length) {
        notify.updateToast(
          toast,
          "No rigs need this action or are currently available.",
          "info",
        );
        return;
      }
      operations.current.set(operation, {
        toast,
        action,
        skipped,
        count: eligible.length,
        rows: new Map(),
      });
      for (const rig of eligible) current.current[rig.id] = operation;
      record(
        eligible.map((r) => ({
          minerId: r.id,
          name: r.name,
          operation,
          action,
          sending: true,
        })),
      );
      for (const scope of ["ALL", "CPU", "GPU"]) {
        const group = eligible.filter((r) => quickScope(r, action) === scope);
        for (let i = 0; i < group.length; i += 8) {
          if (own !== generation.current) {
            record(
              group.slice(i).map((r) => ({
                minerId: r.id,
                operation,
                action,
                error: "Play superseded by Pause before dispatch",
              })),
            );
            break;
          }
          const chunk = group.slice(i, i + 8);
          const write = api.post(
            "/v1/commands",
            { minerIds: chunk.map((r) => r.id), action, deviceType: scope },
            {
              timeout: 65000,
              headers: { "Idempotency-Key": `${operation}:${scope}:${i}` },
            },
          );
          writes.current.add(write);
          try {
            const { data } = await write;
            const results = data.results.map((r) => ({
              ...r,
              operation,
              action,
              name: chunk.find((t) => t.id === r.minerId)?.name,
            }));
            record(results);
            if (results.some((r) => active(r.command)))
              jobs.current.push({ batchId: data.batchId, results });
          } catch (e) {
            record(
              chunk.map((r) => ({
                minerId: r.id,
                name: r.name,
                operation,
                action,
                error: `${message(e)} — outcome not confirmed; check Activity`,
              })),
            );
          } finally {
            writes.current.delete(write);
          }
        }
      }
      changed.current();
    } catch (e) {
      setNotice(message(e));
      notify.updateToast(toast, message(e), "error", 10000);
    } finally {
      setBusy(false);
    }
  }
  return { run, receipts, notice, busy };
}
