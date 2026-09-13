import { useState } from "react";
import { Image, Linking, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { Want, WantOwnerSide } from "@futary/contract";
import { isHttpUrl, MAX_WANT_NOTE_LENGTH, MAX_WANT_TITLE_LENGTH, MAX_WANT_URL_LENGTH } from "@futary/contract";
import { Badge, Button, type Colors, radius, Screen, space, Text, useTheme } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sheet } from "../../components/sheet";
import { useGuestMode } from "../../lib/guest-mode";
import { compressImage, uploadCompressedImage, type SourceImage } from "../../lib/image";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

// 040: ほしいもの。「買ってほしい」ではなく「こういうのが欲しい」を相手に伝える一覧。
// 027 のリスト（ふたりで共有）とは別の機能（タスク定義0節）。
// 人物のタブで切り替える。初期表示は相手。自分を選ぶと追加ボタンが出る（タスク定義5節）

const GRID_COLUMNS = 2;
const GRID_GAP = space.md;

// 039: 色は外観で変わるため、描画時に組み立てる（list.tsx と同じ）
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

// 画像を1枚選ぶ（compose.tsx の pickImages と同じ経路。1枚だけ）
async function pickOneImage(): Promise<SourceImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return { uri: asset.uri, width: asset.width, height: asset.height, mimeType: asset.mimeType };
}

// --- 追加・編集のフォーム（モーダルの中身） ---------------------------------------------

interface WantFormValues {
  title: string;
  url: string;
  note: string;
}

function WantForm({
  initial,
  mode,
  onSubmit,
  onCancel,
  pickedImage,
  onPickImage,
  onRemoveImage,
}: {
  initial: WantFormValues;
  mode: "create" | "edit";
  onSubmit: (values: WantFormValues) => Promise<void>;
  onCancel: () => void;
  // 追加のときだけ画像を付けられる（編集で付け替えるのは「画像を付ける」から）
  pickedImage?: SourceImage | null;
  onPickImage?: () => void | Promise<void>;
  onRemoveImage?: () => void;
}) {
  const { colors } = useTheme();
  const inputStyle = inputStyleOf(colors);
  const [title, setTitle] = useState(initial.title);
  const [url, setUrl] = useState(initial.url);
  const [note, setNote] = useState(initial.note);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const trimmedUrl = url.trim();
  const urlIsValid = trimmedUrl === "" || (trimmedUrl.length <= MAX_WANT_URL_LENGTH && isHttpUrl(trimmedUrl));
  // want.create の下限（title か url のどちらか）と揃える。編集では題名が必須
  const hasRequired = mode === "edit" ? trimmedTitle.length > 0 : trimmedTitle.length > 0 || trimmedUrl.length > 0;
  const canSave =
    hasRequired && urlIsValid && trimmedTitle.length <= MAX_WANT_TITLE_LENGTH && note.length <= MAX_WANT_NOTE_LENGTH;
  // A の決定3: URL から画像を取る間（最大 12 秒）は「画像を取得中…」を出してボタンを無効にする
  const willFetchImage = mode === "create" && trimmedUrl.length > 0 && !pickedImage;
  const savingLabel = willFetchImage ? "画像を取得中…" : "保存中…";

  async function handleSave() {
    if (!canSave) return;
    setErrorMessage(null);
    setIsSaving(true);
    try {
      await onSubmit({ title: trimmedTitle, url: trimmedUrl, note: note.trim() });
    } catch (error) {
      if (error instanceof ORPCError && error.code === "LIMIT_REACHED") {
        setErrorMessage("これ以上は追加できません");
      } else {
        setErrorMessage("保存できませんでした。もう一度お試しください");
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <TextInput
        testID="want-form-url"
        value={url}
        onChangeText={setUrl}
        placeholder="URL（任意。貼ると画像が付きます）"
        placeholderTextColor={colors.textMuted}
        maxLength={MAX_WANT_URL_LENGTH}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={inputStyle}
      />
      {trimmedUrl.length > 0 && !urlIsValid && <Text color="muted">http または https の URL を入力してください</Text>}
      <TextInput
        testID="want-form-title"
        value={title}
        onChangeText={setTitle}
        placeholder={mode === "edit" ? "題名" : "題名（URL が無ければ必須）"}
        placeholderTextColor={colors.textMuted}
        maxLength={MAX_WANT_TITLE_LENGTH}
        style={inputStyle}
      />
      <TextInput
        testID="want-form-note"
        value={note}
        onChangeText={setNote}
        placeholder="メモ（任意）"
        placeholderTextColor={colors.textMuted}
        maxLength={MAX_WANT_NOTE_LENGTH}
        multiline
        style={{ ...inputStyle, minHeight: 60, textAlignVertical: "top" }}
      />
      {mode === "create" && onPickImage && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          {pickedImage ? (
            <>
              <Image
                testID="want-form-picked-image"
                source={{ uri: pickedImage.uri }}
                style={{ width: 56, height: 56, borderRadius: radius.input }}
                accessibilityIgnoresInvertColors
              />
              <Button variant="ghost" onPress={onRemoveImage}>
                画像を外す
              </Button>
            </>
          ) : (
            <Button variant="ghost" onPress={onPickImage}>
              画像を選ぶ（任意）
            </Button>
          )}
        </View>
      )}
      {errorMessage && <Text color="muted">{errorMessage}</Text>}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button variant="ghost" onPress={onCancel} disabled={isSaving}>
            キャンセル
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button onPress={handleSave} disabled={!canSave || isSaving}>
            {isSaving ? savingLabel : "保存"}
          </Button>
        </View>
      </View>
    </View>
  );
}

// --- 一覧のカード ---------------------------------------------

function WantCard({ want, width, onOpenMenu }: { want: Want; width: number | undefined; onOpenMenu?: () => void }) {
  const { colors } = useTheme();
  const isObtained = want.obtainedAt !== null;

  function openUrl() {
    // URL があれば開く（新しいタブ／ブラウザ）。無ければ何もしない（タスク定義5節）
    if (want.url) void Linking.openURL(want.url);
  }

  return (
    <View style={{ width: width ?? "48%" }}>
      <Pressable
        testID={`want-card-${want.id}`}
        accessibilityRole={want.url ? "link" : undefined}
        accessibilityLabel={want.title}
        onPress={openUrl}
        onLongPress={onOpenMenu}
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.input,
          borderWidth: 1,
          borderColor: colors.border,
          padding: space.sm,
          gap: space.xs,
        }}
      >
        <View
          style={{
            width: "100%",
            aspectRatio: 1,
            borderRadius: radius.input,
            backgroundColor: colors.surfaceTint,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {want.image ? (
            <Image
              testID={`want-image-${want.id}`}
              source={{ uri: want.image.url }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          ) : null}
          {/* 画像が無い行は surface-tint の四角だけ（A の指示・段階1のレビュー）。
              絵文字はカラーで描かれ、ホワイト（黒と灰だけの画面）で浮く。素材が無いなら
              何も置かない。URL の有無は押せるかどうかで分かる（押せば開く） */}
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}>
          <View style={{ flex: 1, gap: space.xs }}>
            {/* Amazon の題名は整形後も 100 文字近い。2 列のカードでは 3 行で省略する
                （全文は編集フォームで見える。B の判断。段階1の報告に記載） */}
            <Text size="sm" weight="bold" color={isObtained ? "muted" : undefined} numberOfLines={3}>
              {want.title}
            </Text>
            {want.note.length > 0 && (
              <Text size="xs" color="muted" numberOfLines={2}>
                {want.note}
              </Text>
            )}
            {isObtained && (
              <Badge>
                <Text size="xs" color="muted">
                  手に入れた
                </Text>
              </Badge>
            )}
          </View>
          {/* 自分の行だけ。長押し（Web は … ボタン）でメニュー。相手の行には何も出ない */}
          {onOpenMenu && (
            <Button variant="ghost" onPress={onOpenMenu} accessibilityLabel={`${want.title} のメニュー`}>
              …
            </Button>
          )}
        </View>
      </Pressable>
    </View>
  );
}

// --- 画面 ---------------------------------------------

export default function WantScreen() {
  const { colors } = useTheme();
  const { isGuestMode, exitGuestMode } = useGuestMode();

  // queryKey に viewerKey を含める理由は apps/app/lib/viewer-key.ts 参照（T9）
  const viewerKey = useViewerQueryKey();
  const partnerOptions = orpc.want.list.queryOptions({ input: { ownerSide: "partner" } });
  const partnerQuery = useQuery({ ...partnerOptions, queryKey: [...partnerOptions.queryKey, viewerKey] });
  const mineOptions = orpc.want.list.queryOptions({ input: { ownerSide: "me" } });
  const mineQuery = useQuery({ ...mineOptions, queryKey: [...mineOptions.queryKey, viewerKey] });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.want.list.key() });
  const requestUploadUrl = useMutation(orpc.want.uploadUrl.mutationOptions());
  const createWant = useMutation(orpc.want.create.mutationOptions({ onSuccess: invalidate }));
  const updateWant = useMutation(orpc.want.update.mutationOptions({ onSuccess: invalidate }));
  const setImage = useMutation(orpc.want.setImage.mutationOptions({ onSuccess: invalidate }));
  const setObtained = useMutation(orpc.want.setObtained.mutationOptions({ onSuccess: invalidate }));
  const deleteWant = useMutation(orpc.want.delete.mutationOptions({ onSuccess: invalidate }));

  // 初期は相手（タスク定義5節）
  const [selectedSide, setSelectedSide] = useState<WantOwnerSide>("partner");
  const [gridWidth, setGridWidth] = useState(0);
  const [isAdding, setIsAdding] = useState(false);
  const [pickedImage, setPickedImage] = useState<SourceImage | null>(null);
  const [menuFor, setMenuFor] = useState<Want | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState<Want | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 「そちら側の人」が居るか。partner が居なければ（1人のペア）自分だけ、
  // 自分が居なければ（ゲスト）相手だけ。両方居るときだけタブを出す
  const hasPartner = partnerQuery.data ? partnerQuery.data.ownerName !== null : undefined;
  const hasMe = mineQuery.data ? mineQuery.data.ownerName !== null : undefined;
  const showTabs = hasPartner === true && hasMe === true;
  const effectiveSide: WantOwnerSide = showTabs ? selectedSide : hasPartner === false ? "me" : "partner";
  const activeQuery = effectiveSide === "me" ? mineQuery : partnerQuery;
  const items = activeQuery.data?.items ?? [];
  // 自分のタブでだけ足せる。ゲストは足せない（押してからサーバに拒まれる形にしない）
  const canWrite = effectiveSide === "me" && !isGuestMode;

  const cardWidth = gridWidth > 0 ? (gridWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS : undefined;

  function closeAdd() {
    setIsAdding(false);
    setPickedImage(null);
  }

  async function handleCreate(values: WantFormValues) {
    let imageId: string | undefined;
    if (pickedImage) {
      const compressed = await compressImage(pickedImage);
      const uploaded = await uploadCompressedImage(
        (contentType) => requestUploadUrl.mutateAsync({ contentType }),
        compressed,
      );
      imageId = uploaded.imageId;
    }
    const created = await createWant.mutateAsync({
      title: values.title === "" ? undefined : values.title,
      url: values.url === "" ? undefined : values.url,
      note: values.note === "" ? undefined : values.note,
      imageId,
    });
    closeAdd();
    // 自動取得が失敗した直後の1行（エラー扱いにしない。タスク定義5節）
    setNotice(values.url !== "" && !imageId && created.image === null ? "画像は取れませんでした。あとから付けられます" : null);
  }

  async function handleUpdate(want: Want, values: WantFormValues) {
    await updateWant.mutateAsync({ id: want.id, title: values.title, url: values.url === "" ? null : values.url, note: values.note });
    setEditing(null);
  }

  function closeMenu() {
    setMenuFor(null);
    setConfirmingDelete(false);
  }

  async function runMenuAction(action: () => Promise<unknown>) {
    setErrorMessage(null);
    try {
      await action();
      closeMenu();
    } catch {
      setErrorMessage("更新できませんでした。もう一度お試しください");
      closeMenu();
    }
  }

  async function attachImage(want: Want) {
    const source = await pickOneImage();
    if (!source) return;
    await runMenuAction(async () => {
      const compressed = await compressImage(source);
      const uploaded = await uploadCompressedImage(
        (contentType) => requestUploadUrl.mutateAsync({ contentType }),
        compressed,
      );
      await setImage.mutateAsync({ id: want.id, imageId: uploaded.imageId });
    });
  }

  const tabLabel = (side: WantOwnerSide) =>
    (side === "me" ? mineQuery.data?.ownerName : partnerQuery.data?.ownerName) ?? (side === "me" ? "自分" : "相手");

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.md }}>
        {showTabs && (
          <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: space.sm }}>
            {(["partner", "me"] as const).map((side) => {
              const selected = selectedSide === side;
              return (
                <Pressable
                  key={side}
                  accessibilityRole="tab"
                  aria-selected={selected}
                  onPress={() => setSelectedSide(side)}
                  style={{
                    paddingVertical: space.sm,
                    paddingHorizontal: space.lg,
                    borderRadius: radius.pill,
                    backgroundColor: selected ? colors.primary : colors.surface,
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                  }}
                >
                  <Text weight="bold" color={selected ? "inverse" : undefined}>
                    {tabLabel(side)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {isGuestMode && effectiveSide === "me" ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text color="muted">追加はログインすると使えます</Text>
            <Button variant="ghost" onPress={exitGuestMode}>
              ログイン
            </Button>
          </View>
        ) : canWrite ? (
          // 追加は FAB ではなく一覧の上の + ボタン（FAB は投稿のもの。タスク定義5節）
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
            <Text color="muted" size="sm">
              {items.length === 0 ? "URL を貼ると画像が付きます" : ""}
            </Text>
            <Button onPress={() => setIsAdding(true)} accessibilityLabel="ほしいものを追加">
              ＋ 追加
            </Button>
          </View>
        ) : null}

        {notice && <Text color="muted">{notice}</Text>}
        {errorMessage && <Text color="muted">{errorMessage}</Text>}

        {activeQuery.isLoading ? (
          <View style={{ alignItems: "center", padding: space.xl }}>
            <Text color="muted">読み込み中…</Text>
          </View>
        ) : activeQuery.isError ? (
          <View style={{ alignItems: "center", gap: space.md, padding: space.xl }}>
            <Text color="muted">読み込めませんでした</Text>
            <Button
              variant="secondary"
              onPress={async () => {
                await activeQuery.refetch();
              }}
            >
              再試行
            </Button>
          </View>
        ) : items.length === 0 ? (
          <View style={{ alignItems: "center", padding: space.xl }}>
            <Text color="muted">{effectiveSide === "me" ? "まだありません" : "まだありません"}</Text>
          </View>
        ) : (
          // 白いカードの 2 列グリッド（モックの絵）。幅は index.tsx の機能パネルと同じく実測から算出
          <View
            onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
            style={{ flexDirection: "row", flexWrap: "wrap", columnGap: GRID_GAP, rowGap: GRID_GAP }}
          >
            {items.map((want) => (
              <WantCard
                key={want.id}
                want={want}
                width={cardWidth}
                onOpenMenu={want.isMine && !isGuestMode ? () => setMenuFor(want) : undefined}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* 追加 */}
      <Sheet visible={isAdding} onClose={closeAdd} title="ほしいものを追加">
        {isAdding && (
          <WantForm
            mode="create"
            initial={{ title: "", url: "", note: "" }}
            onSubmit={handleCreate}
            onCancel={closeAdd}
            pickedImage={pickedImage}
            onPickImage={async () => {
              const source = await pickOneImage();
              if (source) setPickedImage(source);
            }}
            onRemoveImage={() => setPickedImage(null)}
          />
        )}
      </Sheet>

      {/* 編集 */}
      <Sheet visible={editing !== null} onClose={() => setEditing(null)} title="ほしいものを編集">
        {editing && (
          <WantForm
            mode="edit"
            initial={{ title: editing.title, url: editing.url ?? "", note: editing.note }}
            onSubmit={(values) => handleUpdate(editing, values)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Sheet>

      {/* 自分の行のメニュー: 手に入れた・画像を付ける／外す・編集・削除 */}
      <Sheet visible={menuFor !== null} onClose={closeMenu} title={menuFor?.title ?? ""}>
        {menuFor && (
          <View style={{ gap: space.sm }}>
            <Button
              variant="secondary"
              onPress={() => runMenuAction(() => setObtained.mutateAsync({ id: menuFor.id, obtained: menuFor.obtainedAt === null }))}
            >
              {menuFor.obtainedAt === null ? "手に入れた" : "手に入れたを取り消す"}
            </Button>
            {menuFor.image ? (
              <Button
                variant="secondary"
                onPress={() => runMenuAction(() => setImage.mutateAsync({ id: menuFor.id, imageId: null }))}
              >
                画像を外す
              </Button>
            ) : (
              <Button variant="secondary" onPress={() => attachImage(menuFor)}>
                画像を付ける
              </Button>
            )}
            <Button
              variant="secondary"
              onPress={() => {
                setEditing(menuFor);
                closeMenu();
              }}
            >
              編集
            </Button>
            {confirmingDelete ? (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button variant="ghost" onPress={() => setConfirmingDelete(false)}>
                    キャンセル
                  </Button>
                </View>
                <View style={{ flex: 1 }}>
                  {/* danger は退会専用（036）。削除の確認は list.tsx と同じ secondary */}
                  <Button variant="secondary" onPress={() => runMenuAction(() => deleteWant.mutateAsync({ id: menuFor.id }))}>
                    削除する
                  </Button>
                </View>
              </View>
            ) : (
              <Button variant="ghost" onPress={() => setConfirmingDelete(true)}>
                削除
              </Button>
            )}
            {Platform.OS === "web" && (
              <Button variant="ghost" onPress={closeMenu}>
                閉じる
              </Button>
            )}
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
