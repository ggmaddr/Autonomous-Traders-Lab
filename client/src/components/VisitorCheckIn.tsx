import { FormEvent, useEffect, useRef, useState } from "react";
import "./visitor-checkin.css";

const KEY = "antimat-checkin-v1";
const PENDING = "antimat-anonymous-pending-v1";
type Visit = { name: string; anonymous: boolean; session_id: string; entry_path: string };
function sendVisit(visit: Visit) {
  return fetch("/api/check-in", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(visit), keepalive: true, signal: AbortSignal.timeout(10000) });
}
function retryAnonymous() {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(PENDING); } catch { return; }
  if (!raw) return;
  try {
    const visit = JSON.parse(raw) as Visit;
    void sendVisit(visit).then((response) => {
      if (response.ok) { try { sessionStorage.removeItem(PENDING); } catch { /* Storage unavailable. */ } }
    }).catch(() => { /* Retain for a reload or reconnection; never block browsing. */ });
  } catch { try { sessionStorage.removeItem(PENDING); } catch { /* Storage unavailable. */ } }
}
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
  useEffect(() => {
    if (document.querySelector('meta[name="visitor-checkin"]')?.getAttribute("content") !== "true") return;
    retryAnonymous();
    window.addEventListener("online", retryAnonymous);
    return () => window.removeEventListener("online", retryAnonymous);
  }, []);
  const close = () => { remember(); dialog.current?.close(); setOpen(false); };
  const skip = () => {
    if (busy) return;
    const visit: Visit = { name: "", anonymous: true, session_id: sessionId.current, entry_path: location.pathname };
    try { sessionStorage.setItem(PENDING, JSON.stringify(visit)); } catch { /* Send even without storage. */ }
    void sendVisit(visit).then((response) => {
      if (response.ok) { try { sessionStorage.removeItem(PENDING); } catch { /* Storage unavailable. */ } }
    }).catch(() => { /* Retry after reload or reconnection. */ });
    close();
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/check-in", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), session_id: sessionId.current, entry_path: location.pathname }),
        signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(response.status === 429 ? "Lots of visitors right now. Try again shortly, or skip." : "Couldn’t save your check-in. Try again, or skip and explore.");
      close();
    } catch (cause) { setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Check-in timed out. Try again, or skip and explore."); }
    finally { setBusy(false); }
  }
  if (!open) return null;
  return <dialog ref={dialog} className="visitor-checkin" aria-labelledby="checkin-title" aria-describedby="checkin-note" onCancel={(event) => { event.preventDefault(); skip(); }}>
    <form onSubmit={submit}>
      <p className="checkin-eyebrow">WELCOME ABOARD</p>
      <h2 id="checkin-title">Who’s exploring the lab?</h2>
      <p>Leave a name so Grady knows you stopped by.</p>
      <label htmlFor="visitor-name">Name or nickname</label>
      <input id="visitor-name" autoFocus autoComplete="off" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="What should I call you?" />
      <p id="checkin-note" className="checkin-note">Optional. Your name, visit time, and entry page are saved privately for Grady to review. This isn’t an account or identity verification.</p>
      {error && <p role="alert" className="checkin-error">{error}</p>}
      <button type="submit" className="checkin-submit" disabled={busy || !name.trim()}>{busy ? "Checking in…" : "Check in & explore"}</button>
      <button type="button" className="checkin-skip" disabled={busy} onClick={skip}>Explore without checking in</button>
      <p className="checkin-session">Asked once per tab session. Refreshing won’t ask again.</p>
    </form>
  </dialog>;
}
