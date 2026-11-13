import { FormEvent, useEffect, useRef, useState } from "react";
import "./visitor-checkin.css";

// Old sessions may have skipped; require a successful named check-in once.
const KEY = "antimat-named-checkin-v2";
function seen() { try { return !!sessionStorage.getItem(KEY); } catch { return false; } }
function remember() { try { sessionStorage.setItem(KEY, "done"); } catch { /* Still dismiss in memory. */ } }

export function VisitorCheckIn() {
  const [open, setOpen] = useState(() => document.querySelector('meta[name="visitor-checkin"]')?.getAttribute("content") === "true" && !seen());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const sessionId = useRef(crypto.randomUUID());
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const close = () => { remember(); dialog.current?.close(); setOpen(false); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/check-in", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), session_id: sessionId.current, entry_path: location.pathname }),
        signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(response.status === 429 ? "Lots of visitors right now. Try again shortly." : "Couldn’t save your check-in. Please try again.");
      close();
    } catch (cause) { setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Check-in timed out. Please try again."); }
    finally { setBusy(false); }
  }
  if (!open) return null;
  return <dialog ref={dialog} className="visitor-checkin" aria-labelledby="checkin-title" aria-describedby="checkin-note" onCancel={(event) => event.preventDefault()}>
    <form onSubmit={submit}>
      <p className="checkin-eyebrow">WELCOME ABOARD</p>
      <h2 id="checkin-title">What should I call you buddy?👨‍🔬</h2>
      <p>Leave any name so I can show off to my parents I got friends.</p>
      <label htmlFor="visitor-name">Name or nickname</label>
      <input id="visitor-name" autoFocus autoComplete="off" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="I'm your manager" />
      <p id="checkin-note" className="checkin-note">Enter a name or nickname to explore.</p>
      {error && <p role="alert" className="checkin-error">{error}</p>}
      <button type="submit" className="checkin-submit" disabled={busy || !name.trim()}>{busy ? "Checking in…" : "Check in & explore"}</button>
    </form>
  </dialog>;
}
