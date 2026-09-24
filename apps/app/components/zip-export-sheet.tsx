import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button, space, Text } from "@futary/ui";
import {
  collectZipPhotos,
  exportZip,
  zipBaseName,
  zipConfirmLabel,
  zipPartCount,
  zipPartsLabel,
  type ZipPhoto,
  type ZipProgress,
  type ZipResult,
  type ZipSource,
} from "../lib/album-zip";
import { Sheet } from "./sheet";

// 「ZIP で保存」のシート（048）。アルバム詳細の ⋯・一覧の ⋯・マイページの 3 箇所で同じものを出す。
// 開く → 数える（photo.list を最後まで）→「38 枚を ZIP で保存します（約 15MB）」→ 保存 →「12 / 38 枚を取得中…」→
// 保存しました（取れなかった枚数があれば 1 行）。「やめる」か閉じると中断（保存した ZIP は残る）

export type ZipExportSheetProps = {
  // null なら閉じている
  source: ZipSource | null;
  onClose: () => void;
};

type Phase =
  | { kind: "counting" }
  | { kind: "empty" }
  | { kind: "confirm"; photos: ZipPhoto[] }
  | { kind: "running"; photos: ZipPhoto[]; progress: ZipProgress }
  | { kind: "done"; result: ZipResult }
  | { kind: "error" };

export function ZipExportSheet({ source, onClose }: ZipExportSheetProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "counting" });
  const abortRef = useRef<AbortController | null>(null);

  // 開くたびに数え直す（写真は増減する）。閉じたら取得を止める
  useEffect(() => {
    if (source === null) return;
    let cancelled = false;
    setPhase({ kind: "counting" });
    collectZipPhotos(source)
      .then((photos) => {
        if (cancelled) return;
        setPhase(photos.length === 0 ? { kind: "empty" } : { kind: "confirm", photos });
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: "error" });
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [source]);

  async function handleStart(photos: ZipPhoto[]) {
    if (source === null || abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "running", photos, progress: { done: 0, total: photos.length } });
    try {
      const result = await exportZip(photos, zipBaseName(source), {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setPhase({ kind: "running", photos, progress });
        },
      });
      if (controller.signal.aborted) return;
      setPhase({ kind: "done", result });
    } catch {
      if (!controller.signal.aborted) setPhase({ kind: "error" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function handleAbort() {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  }

  const title = source?.kind === "all" ? "すべての写真を ZIP で保存" : "ZIP で保存";

  return (
    <Sheet visible={source !== null} onClose={phase.kind === "running" ? handleAbort : onClose} title={title}>
      <View testID="zip-export-sheet" style={{ gap: space.md }}>
        {phase.kind === "counting" && (
          <Text color="muted" align="center">
            写真を数えています…
          </Text>
        )}
        {phase.kind === "empty" && (
          <Text color="muted" align="center" testID="zip-export-empty">
            保存する写真がありません
          </Text>
        )}
        {phase.kind === "error" && (
          <Text color="muted" align="center" testID="zip-export-error">
            保存できませんでした。もう一度お試しください
          </Text>
        )}
        {phase.kind === "confirm" && (
          <>
            <Text align="center" testID="zip-export-confirm">
              {zipConfirmLabel(phase.photos.length)}
            </Text>
            {zipPartCount(phase.photos.length) > 1 && (
              <Text size="sm" color="muted" align="center" testID="zip-export-parts">
                {zipPartsLabel(zipPartCount(phase.photos.length))}
              </Text>
            )}
          </>
        )}
        {phase.kind === "running" && (
          <Text color="muted" align="center" testID="zip-export-progress">
            {`${phase.progress.done} / ${phase.progress.total} 枚を取得中…`}
          </Text>
        )}
        {phase.kind === "done" && (
          <>
            <Text align="center" testID="zip-export-done">
              {phase.result.outcome === "nothing" ? "保存できませんでした。もう一度お試しください" : "保存しました"}
            </Text>
            {phase.result.outcome === "saved" && phase.result.failed > 0 && (
              <Text size="sm" color="muted" align="center" testID="zip-export-failed">
                {`${phase.result.failed} 枚は保存できませんでした`}
              </Text>
            )}
          </>
        )}

        {phase.kind === "confirm" ? (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button variant="ghost" onPress={onClose}>
                キャンセル
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button onPress={() => handleStart(phase.photos)} testID="zip-export-start">
                保存
              </Button>
            </View>
          </View>
        ) : phase.kind === "running" ? (
          <Button variant="ghost" onPress={handleAbort} testID="zip-export-abort">
            やめる
          </Button>
        ) : phase.kind === "counting" ? null : (
          <Button variant="ghost" onPress={onClose} testID="zip-export-close">
            閉じる
          </Button>
        )}
      </View>
    </Sheet>
  );
}
