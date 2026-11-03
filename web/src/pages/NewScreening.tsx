import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, IS_MOCK } from "../api/client";
import type { Eye, View } from "../api/types";
import { ChevronLeft, ImagePlus, Sparkles, Trash2 } from "../components/icons";
import { Page } from "../components/Page";
import { Segmented } from "../components/Segmented";
import { WheelPicker } from "../components/WheelPicker";
import { SPRING } from "../components/motion";
import { VA_VALUES } from "../lib/va";
import { sound } from "../lib/sound";
import { useSettings, useUI } from "../lib/store";
import { drawFundus } from "../lib/fundusArt";
import { analyse } from "../api/fixtures";

interface Shot { id: string; file: Blob; url: string; view: View; fov: number; name: string }
type VAState = { value: string | null };

function genCode() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `RT-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${rnd}`;
}
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function NewScreening() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const defaultFov = useSettings((s) => s.defaultFov);
  const [step, setStep] = useState<0 | 1>(0);
  const [code, setCode] = useState(genCode);
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<"F" | "M" | "X" | "">("");
  const [dy, setDy] = useState("");
  const [va, setVa] = useState<Record<Eye, VAState>>({ OD: { value: null }, OS: { value: null } });
  const [method, setMethod] = useState("Snellen");
  const [operator, setOperator] = useState("S. Iyer");
  const [when, setWhen] = useState(localNow);
  const [shots, setShots] = useState<Record<Eye, Shot[]>>({ OD: [], OS: [] });
  const [phase, setPhase] = useState<"idle" | "creating" | "uploading" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const activeSlot = useRef<Eye>("OD");

  const addFiles = useCallback((eye: Eye, files: Blob[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/") || f.type === "");
    if (!imgs.length) {
      sound.fail();
      toast({ text: "Only image files can be added.", tone: "error" });
      return;
    }
    sound.lowTick();
    setShots((s) => ({
      ...s,
      [eye]: [...s[eye], ...imgs.map((f, i) => ({ id: `${Date.now()}-${i}-${Math.random()}`, file: f, url: URL.createObjectURL(f), view: (s[eye].length + i === 0 ? "macula" : "disc") as View, fov: defaultFov, name: f instanceof File ? f.name : "Pasted image" }))],
    }));
  }, [defaultFov, toast]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (step !== 1) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        addFiles(activeSlot.current, files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [step, addFiles]);
  useEffect(() => () => {
    Object.values(shots).flat().forEach((s) => URL.revokeObjectURL(s.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = shots.OD.length + shots.OS.length;
  const busy = phase === "creating" || phase === "uploading";

  const submit = async () => {
    setErr(null);
    setPhase("creating");
    try {
      const e = await api.createEncounter({
        patient_code: code.trim() || undefined, age: age ? Number(age) : null, sex: sex || null, diabetes_years: dy ? Number(dy) : null,
      });
      await api.putVA(e.id, { OD: { value: va.OD.value }, OS: { value: va.OS.value }, method, operator: operator || null, measured_at: new Date(when).toISOString() });
      setPhase("uploading");
      const all = (["OD", "OS"] as Eye[]).flatMap((eye) => shots[eye].map((s) => ({ eye, s })));
      let n = 0;
      for (const { eye, s } of all) {
        await api.uploadImage(e.id, s.file, eye, s.view, s.fov);
        n++;
        setProgress(n / all.length);
      }
      void qc.invalidateQueries({ queryKey: ["encounters"] });
      sound.lowTick();
      nav(`/screen/${e.id}/analyse`);
    } catch (x) {
      sound.fail();
      setPhase("error");
      setErr(x instanceof Error ? x.message : "Upload failed");
    }
  };

  return (
    <Page>
      <div className="mb-8 flex items-center justify-between">
        <button type="button" onClick={() => (step === 1 ? setStep(0) : nav(-1))} className="btn-ghost h-9 px-3" aria-label="Back">
          <ChevronLeft className="h-4 w-4" /> {step === 1 ? "Patient" : "Back"}
        </button>
        <ProgressCapsule step={step} onStep={(s) => setStep(s)} />
        <div className="w-[92px]" />
      </div>

      <AnimatePresence mode="wait">
        {step === 0 ? (
          <motion.div key="p" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={SPRING}>
            <h1 className="text-title-xl">Patient</h1>
            <p className="mt-1 text-body text-l2">Identify with a code only. No names on this device.</p>
            <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
              <div className="card space-y-5 p-6">
                <Field label="Patient code">
                  <input value={code} onChange={(e) => setCode(e.target.value)} className="input num" placeholder="Auto-generated" aria-label="Patient code" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Age (optional)">
                    <input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))} className="input num" placeholder="e.g. 58" aria-label="Age" />
                  </Field>
                  <Field label="Years with diabetes">
                    <input inputMode="numeric" value={dy} onChange={(e) => setDy(e.target.value.replace(/\D/g, "").slice(0, 2))} className="input num" placeholder="e.g. 12" aria-label="Years with diabetes" />
                  </Field>
                </div>
                <Field label="Sex">
                  <Segmented ariaLabel="Sex" value={sex || "none"} onChange={(v) => setSex(v === "none" ? "" : (v as "F" | "M" | "X"))} options={[{ value: "none", label: "Not given" }, { value: "F", label: "Female" }, { value: "M", label: "Male" }, { value: "X", label: "Other" }]} />
                </Field>
              </div>
              <div className="card p-6">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-title">Visual acuity</h2>
                  <span className="text-footnote text-l2">Worse than 6/12 refers regardless of the model</span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-5">
                  {(["OD", "OS"] as Eye[]).map((eye) => (
                    <div key={eye}>
                      <div className="mb-2 text-eyebrow uppercase text-l2">{eye === "OD" ? "Right eye · OD" : "Left eye · OS"}</div>
                      <WheelPicker label={`VA ${eye}`} values={VA_VALUES} value={va[eye].value} dim={va[eye].value === null} onChange={(v) => setVa((s) => ({ ...s, [eye]: { value: v } }))} />
                      <button
                        type="button"
                        onClick={() => { sound.tick(); setVa((s) => ({ ...s, [eye]: { value: null } })); }}
                        aria-pressed={va[eye].value === null}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-full px-3 py-2 text-[13px] font-semibold transition-colors"
                        style={va[eye].value === null ? { background: "rgba(255,214,10,0.14)", color: "#FFD60A", boxShadow: "inset 0 0 0 0.5px rgba(255,214,10,0.5)" } : { background: "#2C2C2E", color: "rgba(255,255,255,0.6)" }}
                      >
                        Not measured
                      </button>
                      {va[eye].value === null && <div className="mt-1.5 text-center text-[12px] text-review">Missing is not normal</div>}
                    </div>
                  ))}
                </div>
                <div className="mt-6 space-y-4">
                  <Field label="Method">
                    <Segmented ariaLabel="VA method" value={method} onChange={setMethod} options={[{ value: "Snellen", label: "Snellen" }, { value: "Tumbling E", label: "Tumbling E" }, { value: "LogMAR chart", label: "LogMAR chart" }]} />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Operator"><input value={operator} onChange={(e) => setOperator(e.target.value)} className="input" placeholder="Your name" aria-label="Operator" /></Field>
                    <Field label="Measured"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="input num" aria-label="Measured at" /></Field>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-8 flex justify-end">
              <button type="button" className="btn-white h-12 px-8 text-[16px]" onClick={() => { sound.tick(); setStep(1); }}>Continue</button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="i" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={SPRING}>
            <h1 className="text-title-xl">Images</h1>
            <p className="mt-1 text-body text-l2">Drop, browse or paste. As you face the patient, the right eye (OD) is on your left.</p>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {(["OD", "OS"] as Eye[]).map((eye) => (
                <EyeSlot
                  key={eye}
                  eye={eye}
                  shots={shots[eye]}
                  onFocus={() => (activeSlot.current = eye)}
                  onAdd={(f) => addFiles(eye, f)}
                  onChange={(id, p) => setShots((s) => ({ ...s, [eye]: s[eye].map((x) => (x.id === id ? { ...x, ...p } : x)) }))}
                  onRemove={(id) => setShots((s) => ({ ...s, [eye]: s[eye].filter((x) => x.id !== id) }))}
                  disabled={busy}
                />
              ))}
            </div>
            <div className="mt-10 flex flex-col items-center gap-3">
              {err && <div role="alert" className="rounded-full bg-urgent/15 px-4 py-2 text-[14px] text-urgent">{err}</div>}
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                disabled={!total || busy}
                title={busy ? "Uploading…" : !total ? "Add at least one image first" : undefined}
                onClick={() => void submit()}
                className="btn-white relative h-14 min-w-[260px] overflow-hidden px-10 text-[17px]"
              >
                {busy && <motion.span className="absolute inset-y-0 left-0 bg-black/10" animate={{ width: `${(phase === "creating" ? 0.08 : 0.08 + progress * 0.92) * 100}%` }} />}
                <span className="relative">{phase === "creating" ? "Creating encounter…" : phase === "uploading" ? `Uploading ${Math.round(progress * total)}/${total}…` : phase === "error" ? "Try again" : "Analyse"}</span>
              </motion.button>
              <div className="text-footnote text-l3">{total ? `${total} image${total > 1 ? "s" : ""} · both eyes are needed for a routine outcome` : "Add at least one image"}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  );
}

function ProgressCapsule({ step, onStep }: { step: 0 | 1; onStep: (s: 0 | 1) => void }) {
  return (
    <div className="glass flex items-center gap-1 rounded-full p-1" role="tablist" aria-label="Steps">
      {["Patient", "Images"].map((l, i) => (
        <button key={l} type="button" role="tab" aria-selected={step === i} onClick={() => onStep(i as 0 | 1)} className={`relative h-8 rounded-full px-4 text-[13px] font-medium ${step === i ? "text-black" : "text-l2"}`}>
          {step === i && <motion.span layoutId="cap" transition={SPRING} className="absolute inset-0 rounded-full bg-white" />}
          <span className="relative">{i + 1} · {l}</span>
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] text-l2">{label}</span>
      {children}
    </label>
  );
}

function EyeSlot({
  eye, shots, onAdd, onChange, onRemove, onFocus, disabled,
}: { eye: Eye; shots: Shot[]; onAdd: (f: Blob[]) => void; onChange: (id: string, p: Partial<Shot>) => void; onRemove: (id: string) => void; onFocus: () => void; disabled: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const sample = useMemo(() => async () => {
    const seed = Math.floor(Math.random() * 1e6);
    const a = analyse(seed, { grade: (seed % 4) as 0 | 1 | 2 | 3 }, eye, "macula");
    const c = drawFundus({ ...a.art }, 768);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
    if (blob) onAdd([new File([blob], `synthetic-sample-${seed}.jpg`, { type: "image/jpeg" })]);
  }, [eye, onAdd]);
  return (
    <div className="card flex flex-col items-center p-6" onMouseEnter={onFocus} onFocus={onFocus}>
      <div className="text-eyebrow uppercase text-l2">{eye === "OD" ? "Right eye · OD" : "Left eye · OS"}</div>
      <motion.button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!over) { setOver(true); sound.tick(); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onAdd(Array.from(e.dataTransfer.files)); }}
        animate={{ scale: over ? 1.04 : 1 }}
        transition={SPRING}
        className="relative mt-5 grid h-[220px] w-[220px] place-items-center rounded-full"
        aria-label={`Add images for ${eye}`}
      >
        <span aria-hidden className="absolute -inset-10 rounded-full transition-opacity duration-300" style={{ opacity: over ? 1 : 0, background: "radial-gradient(circle, rgba(255,255,255,0.12), transparent 60%)" }} />
        <span aria-hidden className="absolute inset-0 rounded-full transition-shadow duration-300" style={{ boxShadow: over ? "inset 0 0 0 3px #fff, 0 0 40px rgba(255,255,255,0.35)" : "inset 0 0 0 2px rgba(255,255,255,0.14)" }} />
        <span aria-hidden className="absolute inset-[14px] rounded-full" style={{ background: "radial-gradient(circle at 50% 30%, #2c2c2e, #141416 70%)" }} />
        <span className="relative flex flex-col items-center gap-2 text-l2">
          <ImagePlus className="h-7 w-7" />
          <span className="text-[13px] font-medium">Drop or browse</span>
          <span className="text-[11px] text-l3">⌘/Ctrl + V to paste</span>
        </span>
      </motion.button>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { onAdd(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {IS_MOCK && (
        <button type="button" className="chip mt-4" onClick={() => void sample()} disabled={disabled}>
          <Sparkles className="h-3.5 w-3.5" /> Add a synthetic sample (mock)
        </button>
      )}
      <div className="mt-5 w-full space-y-3">
        <AnimatePresence initial={false}>
          {shots.map((s) => (
            <motion.div key={s.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={SPRING} className="flex items-center gap-3 rounded-[18px] bg-s2/60 p-2.5">
              <img src={s.url} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 truncate text-[12px] text-l3">{s.name}</div>
                <Segmented size="sm" ariaLabel="View" value={s.view} onChange={(v) => onChange(s.id, { view: v })} options={[{ value: "macula", label: "Macula" }, { value: "disc", label: "Disc" }, { value: "other", label: "Other" }]} />
              </div>
              <label className="flex flex-col items-center text-[11px] text-l3">
                FOV°
                <input inputMode="numeric" value={s.fov} onChange={(e) => onChange(s.id, { fov: Math.max(20, Math.min(200, Number(e.target.value.replace(/\D/g, "")) || 45)) })} className="input num mt-0.5 h-8 w-14 px-2 text-center text-[13px]" placeholder="45" aria-label="Field of view in degrees" />
              </label>
              <button type="button" onClick={() => onRemove(s.id)} className="grid h-8 w-8 place-items-center rounded-full text-l2 hover:bg-white/10 hover:text-urgent" aria-label="Remove image">
                <Trash2 className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
