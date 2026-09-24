import { useState } from "react";
import { Image, Pressable, TextInput, View } from "react-native";
import { MAX_ALBUM_NOTE_LENGTH, MAX_ALBUM_TITLE_LENGTH } from "@futary/contract";
import { Button, type Colors, radius, space, Text, useTheme } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import type { SourceImage } from "../lib/image";
import { DateInput8 } from "./date-input8";

// アルバムの作成・編集フォーム（041）。作成のときだけカバー写真を選べる（編集では詳細の選択モードで変える）

export interface AlbumFormValues {
  title: string;
  // "" = 無し（YYYY-MM-DD）
  startDate: string;
  endDate: string;
  note: string;
}

export type AlbumFormProps = {
  mode: "create" | "edit";
  initial: AlbumFormValues;
  onSubmit: (values: AlbumFormValues) => Promise<void>;
  onCancel: () => void;
  // 作成時だけ。選んだカバー（無ければ null）と選ぶ操作
  pickedCover?: SourceImage | null;
  onPickCover?: () => void | Promise<void>;
  onRemoveCover?: () => void;
};

// 色は外観で変わるので描画時に組み立てる
function inputStyleOf(colors: Colors) {
  return {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    padding: space.md,
    fontSize: 16,
    color: colors.text,
  } as const;
}

const COVER_SIZE = 160;

export function AlbumForm({ mode, initial, onSubmit, onCancel, pickedCover, onPickCover, onRemoveCover }: AlbumFormProps) {
  const { colors } = useTheme();
  const inputStyle = inputStyleOf(colors);
  const [title, setTitle] = useState(initial.title);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [note, setNote] = useState(initial.note);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  // 終了日は開始日が無いと入れられない。開始日 > 終了日なら保存できない（理由を 1 行）
  const datesAreOrdered = endDate === "" || (startDate !== "" && endDate >= startDate);
  const canSave =
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= MAX_ALBUM_TITLE_LENGTH &&
    note.length <= MAX_ALBUM_NOTE_LENGTH &&
    datesAreOrdered;
  // 作成でカバーがあれば署名付き PUT で送ってから作る（その間は「写真を送っています…」）
  const savingLabel = mode === "create" && pickedCover ? "写真を送っています…" : "保存中…";

  async function handleSave() {
    if (!canSave) return;
    setErrorMessage(null);
    setIsSaving(true);
    try {
      await onSubmit({ title: trimmedTitle, startDate, endDate, note: note.trim() });
    } catch (error) {
      if (error instanceof ORPCError && error.code === "LIMIT_REACHED") {
        setErrorMessage("これ以上は作れません");
      } else {
        setErrorMessage("保存できませんでした。もう一度お試しください");
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      {mode === "create" && onPickCover && (
        <View style={{ alignItems: "center", gap: space.xs }}>
          {/* 大きな四角。押すと画像を選び、選ぶとその場に見える */}
          <Pressable
            onPress={onPickCover}
            accessibilityRole="button"
            accessibilityLabel="カバー写真を選択"
            testID="album-form-cover"
            style={{
              width: COVER_SIZE,
              height: COVER_SIZE,
              borderRadius: radius.card,
              backgroundColor: colors.surfaceTint,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {pickedCover ? (
              <Image
                testID="album-form-cover-image"
                source={{ uri: pickedCover.uri }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <>
                <Text size="xl" color="brand">
                  ＋
                </Text>
                <Text size="xs" color="brand">
                  カバー写真を選択
                </Text>
              </>
            )}
          </Pressable>
          {pickedCover && onRemoveCover && (
            <Button variant="ghost" onPress={onRemoveCover}>
              カバーを外す
            </Button>
          )}
        </View>
      )}
      <Text size="xs" color="muted">
        アルバム名
      </Text>
      <TextInput
        testID="album-form-title"
        value={title}
        onChangeText={setTitle}
        placeholder="例：京都旅行"
        placeholderTextColor={colors.textMuted}
        maxLength={MAX_ALBUM_TITLE_LENGTH}
        style={inputStyle}
      />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text size="xs" color="muted">
            開始日
          </Text>
          <DateInput8 value={startDate} onChange={setStartDate} testID="album-form-start" />
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text size="xs" color="muted">
            終了日
          </Text>
          <DateInput8 value={endDate} onChange={setEndDate} testID="album-form-end" />
        </View>
      </View>
      {!datesAreOrdered && (
        <Text size="sm" color="muted">
          {startDate === "" ? "終了日は開始日を入れてから" : "終了日は開始日以降の日付にしてください"}
        </Text>
      )}
      <Text size="xs" color="muted">
        メモ
      </Text>
      <TextInput
        testID="album-form-note"
        value={note}
        onChangeText={setNote}
        placeholder="このアルバムについてメモを入力…"
        placeholderTextColor={colors.textMuted}
        maxLength={MAX_ALBUM_NOTE_LENGTH}
        multiline
        style={{ ...inputStyle, minHeight: 60, textAlignVertical: "top" }}
      />
      {errorMessage && <Text color="muted">{errorMessage}</Text>}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button variant="ghost" onPress={onCancel} disabled={isSaving}>
            キャンセル
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          {/* 二重発火は Button が防ぐ（conventions.md 4節）。送っている間は無効にする */}
          <Button onPress={handleSave} disabled={!canSave || isSaving}>
            {isSaving ? savingLabel : mode === "create" ? "作成" : "保存"}
          </Button>
        </View>
      </View>
    </View>
  );
}
