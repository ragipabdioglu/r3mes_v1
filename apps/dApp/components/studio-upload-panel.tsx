"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useState } from "react";

import { postAdaptersMultipart } from "@/lib/api/post-adapters";
import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";
import { useR3mesWalletAuth } from "@/lib/hooks/use-r3mes-wallet-auth";
import {
  userFacingHttpMessage,
  userFacingMutationFailure,
} from "@/lib/ui/http-messages";
import {
  isStudioWeightFilename,
  STUDIO_FILE_INPUT_ACCEPT,
  STUDIO_MULTIPART_FIELD_WEIGHTS,
  studioUpload,
} from "@/lib/ui/r3mes-fe-contract";
import { journey, loadingLabel } from "@/lib/ui/product-copy";
import { userFacingWalletAuthError } from "@/lib/ui/wallet-auth-user-message";

type ParsedUploadPayload = {
  adapterId: string;
  status: string;
  benchmarkJobId: string;
};

function parseUploadPayload(body: string): ParsedUploadPayload | null {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const adapterId = j.adapterId;
    const status = j.status;
    const benchmarkJobId = j.benchmarkJobId;
    if (typeof adapterId !== "string" || typeof status !== "string") {
      return null;
    }
    return {
      adapterId,
      status,
      benchmarkJobId:
        typeof benchmarkJobId === "string" ? benchmarkJobId : "—",
    };
  } catch {
    return null;
  }
}

function summarizeUploadSuccess(body: string): string {
  try {
    const j = JSON.parse(body) as { status?: string; adapterId?: string };
    const st = j.status;
    const id = j.adapterId;
    if (st === "PENDING_REVIEW") {
      return id
        ? `Yükleme alındı. Sırada inceleme ve benchmark var. Kayıt: ${id}.`
        : "Yükleme alındı. Sırada inceleme ve benchmark var.";
    }
    if (st) {
      return id
        ? `Yükleme alındı. Durum: ${st}. Kayıt: ${id}.`
        : `Yükleme alındı. Durum: ${st}.`;
    }
  } catch {
    /* raw body */
  }
  return `Yükleme alındı. ${body.slice(0, 400)}`;
}

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | {
      kind: "ok";
      status: number;
      body: string;
      payload: ParsedUploadPayload | null;
    }
  | { kind: "err"; message: string };

export function StudioUploadPanel() {
  const account = useCurrentAccount();
  const { ensureAuthHeaders } = useR3mesWalletAuth();
  const [dragOver, setDragOver] = useState(false);
  const [manifest, setManifest] = useState<File | null>(null);
  /** Tek primer GGUF — backend ile aynı kural (multipart’ta tek `weights` alanı). */
  const [weights, setWeights] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    partitionFiles(files);
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    partitionFiles(files);
  };

  function partitionFiles(files: File[]) {
    let nextWeights: File | null = null;
    let nextManifest: File | null = null;
    for (const f of files) {
      const n = f.name.toLowerCase();
      if (n === "manifest.json" || n.endsWith("r3mes_adapter_manifest.json")) {
        nextManifest = f;
      } else if (isStudioWeightFilename(f.name)) {
        nextWeights = f;
      }
    }
    if (nextManifest) setManifest(nextManifest);
    if (nextWeights) setWeights(nextWeights);
  }

  async function submit() {
    if (!account?.address) {
      setState({
        kind: "err",
        message: journey.connectWalletToUpload,
      });
      return;
    }
    if (!weights) {
      setState({
        kind: "err",
        message: studioUpload.validationNeedGguf,
      });
      return;
    }
    setState({ kind: "uploading" });
    let auth: R3mesWalletAuthHeaders;
    try {
      auth = await ensureAuthHeaders();
    } catch (e) {
      setState({
        kind: "err",
        message: userFacingWalletAuthError(e),
      });
      return;
    }
    try {
      const fd = new FormData();
      if (label.trim()) fd.append("displayName", label.trim());
      fd.append("wallet", account.address);
      if (manifest) fd.append("manifest", manifest, manifest.name);
      fd.append(STUDIO_MULTIPART_FIELD_WEIGHTS, weights, weights.name);
      const res = await postAdaptersMultipart(fd, auth);
      const text = await res.text();
      if (!res.ok) {
        setState({
          kind: "err",
          message: userFacingHttpMessage(res.status, text, "upload"),
        });
        return;
      }
      const payload = parseUploadPayload(text);
      setState({ kind: "ok", status: res.status, body: text, payload });
      window.dispatchEvent(new CustomEvent("r3mes-studio-adapters-changed"));
    } catch {
      setState({
        kind: "err",
        message: userFacingMutationFailure("upload"),
      });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Görünen ad (isteğe bağlı)
        </label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Örn. Resmi danışman personası"
          className="mt-2 w-full max-w-md rounded-lg border border-r3mes-border bg-r3mes-surface px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
        />
      </div>

      <motion.div
        layout
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
          dragOver
            ? "border-violet-400/60 bg-violet-950/20"
            : "border-r3mes-border bg-r3mes-surface/40"
        }`}
      >
        <p className="text-sm text-zinc-300">
          Behavior LoRA dosyasını buraya sürükleyin veya seçin
        </p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          {studioUpload.dropzoneHelp}
        </p>
        <label className="mt-6 inline-flex cursor-pointer rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500">
          Dosya seç
          <input
            type="file"
            className="sr-only"
            accept={STUDIO_FILE_INPUT_ACCEPT}
            onChange={onFileInput}
          />
        </label>
      </motion.div>

      <ul className="space-y-2 text-sm text-zinc-400">
        <li>
          Manifest:{" "}
          <span className="font-mono text-zinc-200">
            {manifest?.name ?? "—"}
          </span>
        </li>
        <li>
          {studioUpload.fileListLabel}:{" "}
          {weights ? (
            <span className="font-mono text-zinc-200">{weights.name}</span>
          ) : (
            "—"
          )}
        </li>
      </ul>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={
          state.kind === "uploading" ||
          !account?.address ||
          !weights
        }
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-r3mes-bg disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state.kind === "uploading" ? loadingLabel : "Behavior LoRA gönder"}
      </button>

      {state.kind === "ok" ? (
        <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3 text-sm text-emerald-100">
          <p>{summarizeUploadSuccess(state.body)}</p>
          {state.payload ? (
            <div className="rounded-md border border-emerald-500/25 bg-emerald-950/40 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-200/90">
                Sonraki adımlar
              </p>
              <p className="mt-2 text-sm leading-relaxed text-emerald-100/95">
                {journey.uploadFlowLead}
              </p>
              <dl className="mt-3 space-y-1.5 text-xs text-zinc-300">
                <div>
                  <dt className="text-zinc-500">Kayıt</dt>
                  <dd className="mt-0.5 font-mono text-zinc-200 break-all">
                    {state.payload.adapterId}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Durum</dt>
                  <dd className="mt-0.5">{state.payload.status}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Benchmark işi</dt>
                  <dd className="mt-0.5 font-mono text-zinc-200 break-all">
                    {state.payload.benchmarkJobId}
                  </dd>
                </div>
              </dl>
              {state.payload.status === "ACTIVE" ? (
                <Link
                  href={`/chat?adapter=${encodeURIComponent(state.payload.adapterId)}`}
                  className="mt-3 inline-flex rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
                >
                  {journey.uploadChatCta}
                </Link>
              ) : (
                <div className="mt-3 space-y-1">
                  <span
                    className="inline-flex cursor-not-allowed rounded-lg border border-zinc-600 bg-zinc-900/80 px-4 py-2 text-sm font-medium text-zinc-500"
                    aria-disabled
                  >
                    {journey.uploadChatCta}
                  </span>
                  <p className="text-xs leading-relaxed text-zinc-400">
                    {journey.uploadChatDisabledReason}
                  </p>
                </div>
              )}
            </div>
          ) : null}
          <p className="text-xs text-emerald-200/80">
            {journey.uploadThenRefreshList}
          </p>
        </div>
      ) : null}
      {state.kind === "err" ? (
        <p className="rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-100">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
