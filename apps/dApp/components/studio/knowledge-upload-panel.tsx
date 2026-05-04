"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useState } from "react";

import { postKnowledgeMultipart } from "@/lib/api/knowledge";
import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";
import { useR3mesWalletAuth } from "@/lib/hooks/use-r3mes-wallet-auth";
import { userFacingMutationFailure } from "@/lib/ui/http-messages";
import {
  knowledgeStudio,
  loadingLabel,
  journey,
} from "@/lib/ui/product-copy";
import { userFacingWalletAuthError } from "@/lib/ui/wallet-auth-user-message";

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "ok"; summary: string }
  | { kind: "err"; message: string };

const KNOWLEDGE_ACCEPT = ".txt,.md,.json,application/json,text/plain,text/markdown";

export function KnowledgeUploadPanel() {
  const account = useCurrentAccount();
  const { ensureAuthHeaders } = useR3mesWalletAuth();
  const [dragOver, setDragOver] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setFile(e.dataTransfer.files?.[0] ?? null);
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    setFile(files[0] ?? null);
  };

  async function submit() {
    if (!account?.address) {
      setState({
        kind: "err",
        message: journey.connectWalletToUpload,
      });
      return;
    }

    if (!collectionName.trim() || !file) {
      setState({
        kind: "err",
        message: knowledgeStudio.validationNeedFileAndCollection,
      });
      return;
    }

    let auth: R3mesWalletAuthHeaders;
    setState({ kind: "uploading" });
    try {
      auth = await ensureAuthHeaders();
    } catch (e) {
      setState({ kind: "err", message: userFacingWalletAuthError(e) });
      return;
    }

    try {
      const fd = new FormData();
      fd.append("collectionName", collectionName.trim());
      fd.append("wallet", account.address);
      if (title.trim()) fd.append("title", title.trim());
      fd.append("file", file, file.name);

      const res = await postKnowledgeMultipart(fd, auth);
      const raw = await res.text();
      if (!res.ok) {
        setState({
          kind: "err",
          message: raw.trim() || userFacingMutationFailure("upload"),
        });
        return;
      }
      setState({
        kind: "ok",
        summary:
          raw.trim() ||
          knowledgeStudio.uploadSuccessFallback.replace("{name}", collectionName.trim()),
      });
      setCollectionName("");
      setTitle("");
      setFile(null);
      window.dispatchEvent(new CustomEvent("r3mes-studio-knowledge-changed"));
    } catch {
      setState({
        kind: "err",
        message: userFacingMutationFailure("upload"),
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            {knowledgeStudio.collectionNameLabel}
          </label>
          <input
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            placeholder={knowledgeStudio.collectionNamePlaceholder}
            className="mt-2 w-full rounded-lg border border-r3mes-border bg-r3mes-surface px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            {knowledgeStudio.documentTitleLabel}
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={knowledgeStudio.documentTitlePlaceholder}
            className="mt-2 w-full rounded-lg border border-r3mes-border bg-r3mes-surface px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
        </div>
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
            ? "border-cyan-400/60 bg-cyan-950/20"
            : "border-r3mes-border bg-r3mes-surface/40"
        }`}
      >
        <p className="text-sm text-zinc-300">
          {knowledgeStudio.dropzoneTitle}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          {knowledgeStudio.dropzoneHelp}
        </p>
        <label className="mt-6 inline-flex cursor-pointer rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500">
          {knowledgeStudio.fileSelectLabel}
          <input
            type="file"
            className="sr-only"
            accept={KNOWLEDGE_ACCEPT}
            onChange={onFileInput}
          />
        </label>
      </motion.div>

      <ul className="space-y-2 text-sm text-zinc-400">
        <li>
          {knowledgeStudio.fileListLabel}:{" "}
          <span className="font-mono text-zinc-200">{file?.name ?? "—"}</span>
        </li>
        <li>{knowledgeStudio.privateFirstHint}</li>
      </ul>

      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-3">
          <p className="font-semibold uppercase tracking-wider text-cyan-100">
            1. Private
          </p>
          <p className="mt-1 text-zinc-500">Yükleme önce yalnız size ait kalır.</p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3">
          <p className="font-semibold uppercase tracking-wider text-amber-100">
            2. Index
          </p>
          <p className="mt-1 text-zinc-500">Chunk, embedding ve profil durumu listede görünür.</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3">
          <p className="font-semibold uppercase tracking-wider text-emerald-100">
            3. Chat
          </p>
          <p className="mt-1 text-zinc-500">Hazır olunca auto source ile kullanılabilir.</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={state.kind === "uploading" || !account?.address || !file}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-r3mes-bg disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state.kind === "uploading" ? loadingLabel : knowledgeStudio.submitLabel}
      </button>

      {state.kind === "ok" ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/25 p-3 text-sm text-emerald-100">
          <p>{state.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("r3mes-studio-knowledge-changed"))}
              className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs font-medium text-emerald-50 hover:bg-emerald-500/10"
            >
              Listeyi yenile
            </button>
            <Link
              href="/chat"
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-emerald-950 hover:bg-emerald-400"
            >
              Chat'e git
            </Link>
          </div>
        </div>
      ) : null}
      {state.kind === "err" ? (
        <div className="rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-100">
          {state.message}
        </div>
      ) : null}
    </div>
  );
}
