import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, TextInput, View } from "react-native";
import type { Album, Photo } from "@futary/contract";
import { MAX_PHOTO_CAPTION_LENGTH, MAX_PHOTOS_PER_ADD, PHOTO_LIST_MAX_LIMIT, TIMELINE_ALBUM_ID } from "@futary/contract";
import { formatDateRangeJa, formatJstDateSlash, inclusiveDays } from "@futary/date";
import { Button, type Colors, FabIcon, radius, Screen, space, Text, useTheme } from "@futary/ui";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { AlbumForm, type AlbumFormValues } from "../../components/album-form";
import { ImageViewer, type ImageViewerImage } from "../../components/image-viewer";
import { Sheet } from "../../components/sheet";
import { pickAlbumImages, uploadAlbumImages, type UploadProgress } from "../../lib/album-upload";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";
import { TAB_BAR_BOTTOM_MARGIN, TAB_BAR_CLEARANCE, TAB_BAR_HEIGHT } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

// 041: アルバムの詳細。`?id=` が timeline ならタイムライン（仮想）。
// タスク定義3節は `(tabs)/album/[id].tsx` だが、apps/app は web.output="static" で
// 「動的セグメントが無いから全ルートが実ファイルとして書き出せる」前提（scripts/build-public.mjs）
// のため、動的ルートを足すとその前提が崩れる。A が許した `?id=` に倒した（結果に書く。
// (tabs) の外には出さない: タブバーを消さない）

const GRID_COLUMNS = 3;
const GRID_GAP = space.xs;
const FAB_SIZE = 56;
const TIMELINE_TITLE = "タイムライン";

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

function photoKey(photo: Photo): string {
  return photo.ref.kind === "album" ? photo.ref.photoId : `${photo.ref.postId}:${photo.ref.position}`;
}

// 見出しの 2 行: 期間と「N枚の写真・M日間の思い出」（期間が無ければ「N枚の写真」だけ）。
// 日付計算は packages/date（architecture.md 5節）
function headingLines(photoCount: number, startDate: string | null, endDate: string | null): { period: string | null; summary: string } {
  if (startDate === null) return { period: null, summary: `${photoCount}枚の写真` };
  return {
    period: formatDateRangeJa(startDate, endDate),
    summary: `${photoCount}枚の写真・${inclusiveDays(startDate, endDate)}日間の思い出`,
  };
}

function HeaderTextButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={space.sm} testID={testID} style={{ paddingHorizontal: space.md }}>
      <Text color="brand">{label}</Text>
    </Pressable>
  );
}

export default function AlbumDetailScreen() {
  const { colors, shadow } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { isGuestMode } = useGuestMode();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const albumId = typeof params.id === "string" && params.id !== "" ? params.id : TIMELINE_ALBUM_ID;
  const isTimeline = albumId === TIMELINE_ALBUM_ID;
  // ゲストは見られる。+・選択・編集を出さない。タイムラインにも無い（自動）
  const canWrite = !isGuestMode && !isTimeline;

  // queryKey に viewerKey を含める理由は apps/app/lib/viewer-key.ts 参照（T10）
  const viewerKey = useViewerQueryKey();
  const albumOptions = orpc.album.get.queryOptions({ input: { id: albumId } });
  const albumQuery = useQuery({ ...albumOptions, queryKey: [...albumOptions.queryKey, viewerKey], enabled: !isTimeline });
  // タイムラインの枚数は album.list の timeline から（行を持たないため album.get は無い）
  const listOptions = orpc.album.list.queryOptions({ input: {} });
  const listQuery = useQuery({ ...listOptions, queryKey: [...listOptions.queryKey, viewerKey], enabled: isTimeline });
  const photosOptions = orpc.photo.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ albumId: isTimeline ? undefined : albumId, cursor, limit: PHOTO_LIST_MAX_LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const photosQuery = useInfiniteQuery({ ...photosOptions, queryKey: [...photosOptions.queryKey, viewerKey] });

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.album.get.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.album.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.photo.list.key() }),
    ]);
  const requestUploadUrl = useMutation(orpc.album.uploadUrl.mutationOptions());
  const addPhotos = useMutation(orpc.album.addPhotos.mutationOptions({ onSuccess: invalidateAll }));
  const updateAlbum = useMutation(orpc.album.update.mutationOptions({ onSuccess: invalidateAll }));
  const removePhotos = useMutation(orpc.album.removePhotos.mutationOptions({ onSuccess: invalidateAll }));
  const updatePhoto = useMutation(orpc.album.updatePhoto.mutationOptions({ onSuccess: invalidateAll }));

  const album: Album | undefined = albumQuery.data;
  const title = isTimeline ? TIMELINE_TITLE : (album?.title ?? "アルバム");
  const photos = useMemo(() => photosQuery.data?.pages.flatMap((page) => page.items) ?? [], [photosQuery.data]);
  const photoCount = isTimeline ? (listQuery.data?.timeline.photoCount ?? photos.length) : (album?.photoCount ?? photos.length);

  const [gridWidth, setGridWidth] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [captionFor, setCaptionFor] = useState<Photo | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tileSize = gridWidth > 0 ? (gridWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS : undefined;
  const selectedIds = [...selected];

  function stopSelecting() {
    setIsSelecting(false);
    setSelected(new Set());
    setConfirmingRemove(false);
  }

  // ヘッダー: 題名と、編集・選択（メンバーのアルバムだけ）。選択モードでは「N 枚を選択中」「やめる」
  useEffect(() => {
    navigation.setOptions({
      title: isSelecting ? `${selected.size} 枚を選択中` : title,
      // 戻る先は一覧に固定する（Tabs の中の href: null の画面同士では router.back() の行き先が
      // 履歴に依存して安定しない。撮影スクリプトで実測: ホームへ戻ることがあった）
      headerLeft: () => <HeaderTextButton label="‹ 戻る" onPress={() => router.push("/album")} testID="album-detail-back" />,
      headerRight: isSelecting
        ? () => <HeaderTextButton label="やめる" onPress={stopSelecting} testID="album-detail-stop-selecting" />
        : canWrite
          ? () => (
              <View style={{ flexDirection: "row" }}>
                <HeaderTextButton label="編集" onPress={() => setIsEditing(true)} testID="album-detail-edit" />
                <HeaderTextButton label="選択" onPress={() => setIsSelecting(true)} testID="album-detail-select" />
              </View>
            )
          : undefined,
    });
    // stopSelecting・router は毎回同じ振る舞い。依存に入れると setOptions が描画のたびに走る
  }, [navigation, title, canWrite, isSelecting, selected.size]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // + FAB: 写真を追加（複数選択。1 回 20 枚まで）→ 圧縮 → 1 枚ずつ署名付き PUT → addPhotos（1 回）。
  // 途中で 1 枚でも失敗したら addPhotos を呼ばない（T15）
  async function handleAddPhotos() {
    if (!canWrite || uploadProgress) return;
    const sources = await pickAlbumImages(MAX_PHOTOS_PER_ADD);
    if (sources.length === 0) return;
    setNotice(null);
    try {
      const uploaded = await uploadAlbumImages(
        sources,
        (contentType) => requestUploadUrl.mutateAsync({ contentType }),
        setUploadProgress,
      );
      await addPhotos.mutateAsync({
        id: albumId,
        photos: uploaded.map((u) => ({ imageId: u.imageId, width: u.imageWidth, height: u.imageHeight })),
      });
    } catch {
      setNotice("送れませんでした。もう一度お試しください");
    } finally {
      setUploadProgress(null);
    }
  }

  async function handleSetCover() {
    const [photoId] = selectedIds;
    if (!photoId || selectedIds.length !== 1) return;
    setNotice(null);
    try {
      await updateAlbum.mutateAsync({ id: albumId, coverPhotoId: photoId });
      stopSelecting();
    } catch {
      setNotice("更新できませんでした。もう一度お試しください");
    }
  }

  async function handleRemoveSelected() {
    if (selectedIds.length === 0) return;
    setNotice(null);
    try {
      await removePhotos.mutateAsync({ id: albumId, photoIds: selectedIds });
      stopSelecting();
    } catch {
      setNotice("削除できませんでした。もう一度お試しください");
      setConfirmingRemove(false);
    }
  }

  async function handleUpdate(values: AlbumFormValues) {
    await updateAlbum.mutateAsync({
      id: albumId,
      title: values.title,
      note: values.note,
      startDate: values.startDate === "" ? null : values.startDate,
      endDate: values.endDate === "" ? null : values.endDate,
    });
    setIsEditing(false);
  }

  function openCaptionEditor(index: number) {
    const photo = photos[index];
    if (!photo || photo.ref.kind !== "album") return;
    setCaptionDraft(photo.caption);
    setCaptionFor(photo);
  }

  async function handleSaveCaption() {
    if (!captionFor || captionFor.ref.kind !== "album") return;
    setNotice(null);
    try {
      await updatePhoto.mutateAsync({ id: albumId, photoId: captionFor.ref.photoId, caption: captionDraft.trim() });
      setCaptionFor(null);
    } catch {
      setNotice("保存できませんでした。もう一度お試しください");
      setCaptionFor(null);
    }
  }

  // ビューアには photo.list の読み込み済みの範囲を送る（次ページの先読みはしない。端で止まる）。
  // caption = { アルバム名（タイムラインなら「タイムライン」）, 撮影日, 説明文（タイムラインなら投稿本文） }
  const viewerImages: ImageViewerImage[] = photos.map((photo) => ({
    url: photo.url,
    width: photo.width,
    height: photo.height,
    caption: { title, date: formatJstDateSlash(photo.takenAt), body: photo.caption },
    download: photo.ref,
  }));

  const cover = isTimeline ? photos[0] : null;
  const coverUrl = isTimeline ? cover?.url : album?.cover?.url;
  const heading = headingLines(photoCount, album?.startDate ?? null, album?.endDate ?? null);
  const isLoading = photosQuery.isLoading || (!isTimeline && albumQuery.isLoading);
  const isError = photosQuery.isError || (!isTimeline && albumQuery.isError);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE + FAB_SIZE, gap: space.md }}>
        {isLoading ? (
          <View style={{ alignItems: "center", padding: space.xl }}>
            <Text color="muted">読み込み中…</Text>
          </View>
        ) : isError ? (
          <View style={{ alignItems: "center", gap: space.md, padding: space.xl }}>
            <Text color="muted">読み込めませんでした</Text>
            <Button
              variant="secondary"
              onPress={async () => {
                await Promise.all([photosQuery.refetch(), albumQuery.refetch()]);
              }}
            >
              再試行
            </Button>
          </View>
        ) : (
          <>
            {/* カバー（横長）。無ければ surface-tint の四角 */}
            <View
              testID="album-detail-cover"
              style={{ width: "100%", aspectRatio: 16 / 10, borderRadius: radius.card, backgroundColor: colors.surfaceTint, overflow: "hidden" }}
            >
              {coverUrl && (
                <Image source={{ uri: coverUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
              )}
            </View>
            <View style={{ alignItems: "center", gap: space.xs }}>
              {heading.period && (
                <Text color="muted" testID="album-detail-period">
                  {heading.period}
                </Text>
              )}
              <Text color="muted" testID="album-detail-summary">
                {heading.summary}
              </Text>
              {album && album.note.length > 0 && (
                <Text size="sm" color="muted" align="center">
                  {album.note}
                </Text>
              )}
            </View>

            {uploadProgress && (
              <Text color="muted" align="center" testID="album-detail-progress">
                {`${uploadProgress.done} / ${uploadProgress.total} 枚を送っています…`}
              </Text>
            )}
            {notice && (
              <Text color="muted" align="center">
                {notice}
              </Text>
            )}

            {photos.length === 0 ? (
              <View style={{ alignItems: "center", padding: space.xl }}>
                <Text color="muted">{isTimeline ? "まだ写真がありません" : "写真を追加しましょう"}</Text>
              </View>
            ) : (
              // 3 列の正方形グリッド。押すとビューア（選択モードでは選ぶ）
              <View
                onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
                style={{ flexDirection: "row", flexWrap: "wrap", columnGap: GRID_GAP, rowGap: GRID_GAP }}
              >
                {photos.map((photo, index) => {
                  const key = photoKey(photo);
                  const isSelected = selected.has(key);
                  return (
                    <Pressable
                      key={key}
                      testID={`album-photo-${key}`}
                      accessibilityRole="button"
                      accessibilityLabel={isSelecting ? `${index + 1}枚目を選ぶ` : `${index + 1}枚目を全画面表示`}
                      aria-selected={isSelecting ? isSelected : undefined}
                      onPress={() => (isSelecting ? toggleSelected(key) : setViewerIndex(index))}
                      style={{
                        width: tileSize ?? "32%",
                        aspectRatio: 1,
                        borderRadius: radius.input,
                        overflow: "hidden",
                        backgroundColor: colors.surfaceTint,
                        opacity: isSelecting && !isSelected ? 0.6 : 1,
                      }}
                    >
                      <Image source={{ uri: photo.url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
                      {isSelecting && (
                        <View
                          testID={isSelected ? `album-photo-check-${key}` : undefined}
                          style={{
                            position: "absolute",
                            top: space.xs,
                            right: space.xs,
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            borderWidth: 2,
                            borderColor: colors.surface,
                            backgroundColor: isSelected ? colors.primary : colors.overlay,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {isSelected && (
                            <Text color="inverse" size="xs">
                              ✓
                            </Text>
                          )}
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {photosQuery.hasNextPage && (
              <Button
                variant="ghost"
                onPress={async () => {
                  await photosQuery.fetchNextPage();
                }}
              >
                {photosQuery.isFetchingNextPage ? "読み込み中…" : "もっと見る"}
              </Button>
            )}
          </>
        )}
      </ScrollView>

      {/* 選択モードの下のバー: 「カバーにする」（1 枚のときだけ）「削除」（確認） */}
      {isSelecting && (
        <View
          testID="album-detail-selection-bar"
          style={{
            position: "absolute",
            left: space.lg,
            right: space.lg,
            bottom: TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_MARGIN + space.md,
            backgroundColor: colors.surface,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: colors.border,
            padding: space.md,
            gap: space.sm,
            ...shadow.card,
          }}
        >
          {confirmingRemove ? (
            <>
              <Text color="muted" align="center">{`${selected.size} 枚を削除しますか？`}</Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button variant="ghost" onPress={() => setConfirmingRemove(false)}>
                    キャンセル
                  </Button>
                </View>
                <View style={{ flex: 1 }}>
                  <Button variant="secondary" onPress={handleRemoveSelected}>
                    削除する
                  </Button>
                </View>
              </View>
            </>
          ) : (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button variant="secondary" onPress={handleSetCover} disabled={selected.size !== 1} testID="album-detail-set-cover">
                  カバーにする
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button variant="secondary" onPress={() => setConfirmingRemove(true)} disabled={selected.size === 0} testID="album-detail-remove">
                  削除
                </Button>
              </View>
            </View>
          )}
        </View>
      )}

      {/* + FAB: 写真を追加（アップロード）。このタスクではここだけ FAB を使う。タイムライン・ゲストには無い */}
      {canWrite && !isSelecting && (
        <Pressable
          onPress={handleAddPhotos}
          disabled={uploadProgress !== null}
          accessibilityRole="button"
          accessibilityLabel="写真を追加"
          testID="album-detail-add"
          style={({ pressed }) => ({
            position: "absolute",
            right: space.lg,
            bottom: TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_MARGIN + space.md,
            borderRadius: FAB_SIZE / 2,
            opacity: pressed || uploadProgress !== null ? 0.7 : 1,
            ...shadow.fab,
          })}
        >
          <FabIcon size={FAB_SIZE} />
        </Pressable>
      )}

      <ImageViewer
        visible={viewerIndex !== null}
        images={viewerImages}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
        onEditCaption={canWrite ? openCaptionEditor : undefined}
      />

      {/* 編集 */}
      <Sheet visible={isEditing} onClose={() => setIsEditing(false)} title="アルバムを編集">
        {isEditing && album && (
          <AlbumForm
            mode="edit"
            initial={{ title: album.title, startDate: album.startDate ?? "", endDate: album.endDate ?? "", note: album.note }}
            onSubmit={handleUpdate}
            onCancel={() => setIsEditing(false)}
          />
        )}
      </Sheet>

      {/* 説明文の入力（1 行のモーダル） */}
      <Sheet visible={captionFor !== null} onClose={() => setCaptionFor(null)} title="写真の説明">
        <TextInput
          testID="album-caption-input"
          value={captionDraft}
          onChangeText={setCaptionDraft}
          placeholder="この写真について"
          placeholderTextColor={colors.textMuted}
          maxLength={MAX_PHOTO_CAPTION_LENGTH}
          style={inputStyleOf(colors)}
        />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button variant="ghost" onPress={() => setCaptionFor(null)}>
              キャンセル
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button onPress={handleSaveCaption} testID="album-caption-save">
              保存
            </Button>
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}
