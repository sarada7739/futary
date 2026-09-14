import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, TextInput, View } from "react-native";
import type { Album, Photo } from "@futary/contract";
import {
  MAX_PHOTO_CAPTION_LENGTH,
  MAX_PHOTOS_PER_ADD,
  MAX_PHOTOS_PER_REMOVE,
  PHOTO_LIST_MAX_LIMIT,
  TIMELINE_ALBUM_ID,
} from "@futary/contract";
import { formatDateRangeJa, formatJstDateSlash, inclusiveDays } from "@futary/date";
import { Button, type Colors, FabIcon, radius, Screen, space, Text, useTheme } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { AlbumForm, type AlbumFormValues } from "../../components/album-form";
import { ImageViewer, type ImageViewerImage } from "../../components/image-viewer";
import { PlanLimitSheet } from "../../components/plan-limit-sheet";
import { QuotaWarningCard } from "../../components/quota-warning-card";
import { Sheet } from "../../components/sheet";
import { ZipExportSheet } from "../../components/zip-export-sheet";
import { ALBUM_UPLOAD_BATCH_MAX, pickAlbumImages, uploadAlbumImagesInBatches, type UploadProgress } from "../../lib/album-upload";
import type { ZipSource } from "../../lib/album-zip";
import type { SourceImage } from "../../lib/image";
import { chunk } from "../../lib/chunk";
import { albumQuotaHeadingLabel, albumQuotaOverLabel, albumQuotaRemaining, shouldWarnQuota } from "../../lib/plan";
import { dismissQuotaWarning, isQuotaWarningDismissed } from "../../lib/quota-warning-dismissed";
import { canShareFiles, MAX_SHARE_FILES, sharePhotos, type ShareProgress } from "../../lib/photo-download";
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
// 045: FAB の上に固定で乗る警告のカードの高さぶん（B が決めた）
const QUOTA_WARNING_CLEARANCE = 120;
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
  // ゲストは見られる。+・編集を出さない。タイムラインにも無い（自動）
  const canWrite = !isGuestMode && !isTimeline;
  // 042: 共有シートに File を渡せる環境（iPhone・Android）では、選択モードに「保存」を出す。
  // ゲストもタイムラインも押せる（041 の保存と同じ理由）。PC には出さない。判定は起動後に変わらない
  const canShare = useMemo(() => canShareFiles(), []);
  // 選択モードに入れるのは、写真を消せる（メンバーのアルバム）か、まとめて保存できる（共有シート）とき
  const canSelect = canWrite || canShare;
  // 048: ⋯（ZIP で保存）はタイムライン以外の全員（ゲストも押せる。タイムラインの ZIP は作らない。タスク定義 5節）
  const canExportZip = !isTimeline;

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
  // 045: 無料枠は couple.get から取る（album.get には持たない。2 箇所に持たない）。
  // 書けるときだけ読む（ゲスト・タイムラインには枠の表示が無い）
  const coupleOptions = orpc.couple.get.queryOptions();
  const coupleQuery = useQuery({ ...coupleOptions, queryKey: [...coupleOptions.queryKey, viewerKey], enabled: canWrite });
  // paid なら null（制限しない）。届く前も null（枠の行を出さず、FAB は普通に動く。サーバが最終防御）
  const albumQuota = coupleQuery.data?.albumQuota ?? null;
  const quotaRemaining = albumQuota ? albumQuotaRemaining(albumQuota) : null;

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.album.get.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.album.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.photo.list.key() }),
      // 045: 枠の used も変わる
      queryClient.invalidateQueries({ queryKey: orpc.couple.get.key() }),
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
  // 049: 20 枚超を選んだときの確認（送る前）。null なら閉じている
  const [uploadConfirm, setUploadConfirm] = useState<SourceImage[] | null>(null);
  // 049: 送っている途中で「やめる」（送り終えた塊は残る）
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [shareProgress, setShareProgress] = useState<ShareProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 045: 無料枠の残りが 0 のとき（FAB を押した・サーバが PLAN_LIMIT を返した）に出すシート
  const [planLimitOpen, setPlanLimitOpen] = useState(false);
  // 048: ヘッダーの ⋯ のメニューと、「ZIP で保存」のシート
  const [menuOpen, setMenuOpen] = useState(false);
  const [zipSource, setZipSource] = useState<ZipSource | null>(null);
  // 045: 残りが 5 枚以下なら FAB の上に警告（3節。絵 01）。選択中は FAB と一緒に隠す。
  // × で消せる（人間の指示）。消した状態は sessionStorage に「消したときの残り枚数」で持ち、
  // 残りが変わればまた出す。描いたあと（useEffect）に読む理由は index.tsx のシートと同じ
  // （静的書き出しでは window が無い）
  const [warningDismissed, setWarningDismissed] = useState(false);
  useEffect(() => {
    setWarningDismissed(quotaRemaining !== null && isQuotaWarningDismissed(quotaRemaining));
  }, [quotaRemaining]);
  function handleDismissWarning() {
    if (quotaRemaining !== null) dismissQuotaWarning(quotaRemaining);
    setWarningDismissed(true);
  }
  const showQuotaWarning =
    canWrite && !isSelecting && !warningDismissed && albumQuota !== null && shouldWarnQuota(albumQuota);

  const tileSize = gridWidth > 0 ? (gridWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS : undefined;
  const selectedIds = [...selected];
  // 042 1節: 1 回の共有は MAX_SHARE_FILES 枚まで。超えていたら「保存」を押せなくして 1 行を出す
  const tooManyToShare = canShare && selected.size > MAX_SHARE_FILES;

  function stopSelecting() {
    setIsSelecting(false);
    setSelected(new Set());
    setConfirmingRemove(false);
  }

  // ヘッダー: 題名と、編集・選択（メンバーのアルバムだけ）・⋯（ZIP で保存。048）。選択モードでは「N 枚を選択中」「やめる」
  useEffect(() => {
    navigation.setOptions({
      title: isSelecting ? `${selected.size} 枚を選択中` : title,
      // 戻る先は一覧に固定する（Tabs の中の href: null の画面同士では router.back() の行き先が
      // 履歴に依存して安定しない。撮影スクリプトで実測: ホームへ戻ることがあった）
      headerLeft: () => <HeaderTextButton label="‹ 戻る" onPress={() => router.push("/album")} testID="album-detail-back" />,
      headerRight: isSelecting
        ? () => <HeaderTextButton label="やめる" onPress={stopSelecting} testID="album-detail-stop-selecting" />
        : canSelect || canExportZip
          ? () => (
              <View style={{ flexDirection: "row" }}>
                {canWrite && <HeaderTextButton label="編集" onPress={() => setIsEditing(true)} testID="album-detail-edit" />}
                {canSelect && <HeaderTextButton label="選択" onPress={() => setIsSelecting(true)} testID="album-detail-select" />}
                {canExportZip && <HeaderTextButton label="⋯" onPress={() => setMenuOpen(true)} testID="album-detail-menu" />}
              </View>
            )
          : undefined,
    });
    // stopSelecting・router は毎回同じ振る舞い。依存に入れると setOptions が描画のたびに走る
  }, [navigation, title, canWrite, canSelect, canExportZip, isSelecting, selected.size]);

  // 選択に上限は掛けない（042 1節。選択モードは削除・カバーと共用で、選ぶ時点では何をするか分からない。
  // 100 枚を超える削除は分けて送る）。20 枚の上限は下のバーの「保存」に掛ける（tooManyToShare）
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 042: 選んだ写真を表示順に共有シートへ（fetch → File を枚数ぶん。進捗「3 / 12 枚を取得中…」）。
  // 閉じた（AbortError）ときは何もしない（選択は残す）。取得できなかった枚数は共有シートのあとに 1 行
  async function handleShareSelected() {
    if (selected.size === 0 || tooManyToShare || shareProgress) return;
    const refs = photos.filter((photo) => selected.has(photoKey(photo))).map((photo) => photo.ref);
    setNotice(null);
    try {
      const result = await sharePhotos(refs, setShareProgress);
      if (result.outcome === "nothing") {
        setNotice("取得できませんでした。もう一度お試しください");
      } else if (result.outcome === "shared") {
        if (result.failed > 0) setNotice(`${result.failed} 枚は取得できませんでした`);
        stopSelecting();
      } else if (result.failed > 0) {
        setNotice(`${result.failed} 枚は取得できませんでした`);
      }
    } catch {
      setNotice("保存できませんでした。もう一度お試しください");
    } finally {
      setShareProgress(null);
    }
  }

  // + FAB: 写真を追加（複数選択。049: 1 回 100 枚まで）→ 20 枚ずつ「1 枚ずつ圧縮 → 署名付き PUT → addPhotos」。
  // 塊の中で 1 枚でも失敗したらその塊は入らず（T15）、残りの塊は続ける。20 枚超は送る前に確認を 1 つ
  async function handleAddPhotos() {
    if (!canWrite || uploadProgress) return;
    // 045: 残りが 0 なら選ぶ前にシート（写真を選ばせない。タスク定義 3節）
    if (quotaRemaining === 0) {
      setPlanLimitOpen(true);
      return;
    }
    const sources = await pickAlbumImages(ALBUM_UPLOAD_BATCH_MAX);
    if (sources.length === 0) return;
    // 049 T3: Web の選択画面には上限が無いので、超えていたら 1 行で止める（送らない）
    if (sources.length > ALBUM_UPLOAD_BATCH_MAX) {
      setNotice(`一度に入れられるのは ${ALBUM_UPLOAD_BATCH_MAX} 枚までです`);
      return;
    }
    // 045: 残り n 枚で n+1 枚以上選んだ → 送る前に 1 行で止める（サーバでも拒む）
    if (albumQuota && sources.length > albumQuotaRemaining(albumQuota)) {
      setNotice(albumQuotaOverLabel(albumQuota));
      return;
    }
    setNotice(null);
    // 049: 20 枚超は「N 枚を送ります。少し時間がかかります」→「送る」。20 枚以下は今までどおり確認無し
    if (sources.length > MAX_PHOTOS_PER_ADD) {
      setUploadConfirm(sources);
      return;
    }
    await runUpload(sources);
  }

  async function runUpload(sources: SourceImage[]) {
    setUploadConfirm(null);
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    try {
      const result = await uploadAlbumImagesInBatches(
        sources,
        (contentType) => requestUploadUrl.mutateAsync({ contentType }),
        (uploaded) =>
          addPhotos.mutateAsync({
            id: albumId,
            photos: uploaded.map((u) => ({ imageId: u.imageId, width: u.imageWidth, height: u.imageHeight })),
          }),
        {
          onProgress: setUploadProgress,
          signal: controller.signal,
          // 045: サーバが PLAN_LIMIT を返したら残りの塊は送らずシート（枠が無いので続けても同じ）
          stopOn: (error) => error instanceof ORPCError && error.code === "PLAN_LIMIT",
        },
      );
      if (result.aborted) {
        setNotice(`${result.added} 枚まで入りました`);
      } else if (result.added === 0 && result.failed > 0) {
        setNotice("送れませんでした。もう一度お試しください");
      } else if (result.failed > 0) {
        setNotice(`${result.failed} 枚は入れられませんでした`);
      }
    } catch (error) {
      // 045: 相手が同時に足した等でサーバが PLAN_LIMIT を返したら同じシート（枠の表示も読み直す）
      if (error instanceof ORPCError && error.code === "PLAN_LIMIT") {
        setPlanLimitOpen(true);
        void queryClient.invalidateQueries({ queryKey: orpc.couple.get.key() });
      } else {
        setNotice("送れませんでした。もう一度お試しください");
      }
    } finally {
      uploadAbortRef.current = null;
      setUploadProgress(null);
    }
  }

  function handleAbortUpload() {
    uploadAbortRef.current?.abort();
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

  // 契約の上限（1 回 100 枚）を超える選択は 100 ずつに分けて順に送る（R の段階1レビュー。
  // 60 枚読み込み → 「もっと見る」で 100 枚を超えて選べる）。途中で失敗したら残りは送らず、
  // 消えた分は消えたまま（invalidate で画面に反映される）
  async function handleRemoveSelected() {
    if (selectedIds.length === 0) return;
    setNotice(null);
    try {
      for (const photoIds of chunk(selectedIds, MAX_PHOTOS_PER_REMOVE)) {
        await removePhotos.mutateAsync({ id: albumId, photoIds });
      }
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
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          // 045: 警告のカードが FAB の上に固定で乗るときは、その分も空ける（B が決めた: 120）
          paddingBottom: TAB_BAR_CLEARANCE + FAB_SIZE + (showQuotaWarning ? QUOTA_WARNING_CLEARANCE : 0),
          gap: space.md,
        }}
      >
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
              {/* 045: 無料枠「27 / 30 枚」。上限なら「30 / 30 枚 - 上限に達しています」（絵 03 の上の行）。
                  free のときだけ（paid・ゲスト・タイムラインには無い） */}
              {canWrite && albumQuota && (
                <Text size="sm" color="brand" testID="album-detail-quota">
                  {albumQuotaHeadingLabel(albumQuota)}
                </Text>
              )}
              {album && album.note.length > 0 && (
                <Text size="sm" color="muted" align="center">
                  {album.note}
                </Text>
              )}
            </View>

            {uploadProgress && (
              <View style={{ alignItems: "center", gap: space.xs }}>
                <Text color="muted" align="center" testID="album-detail-progress">
                  {`${uploadProgress.done} / ${uploadProgress.total} 枚を送っています…`}
                </Text>
                {/* 049: 20 枚超のときだけ「やめる」（送り終えた塊は残る。閉じたら「N 枚まで入りました」） */}
                {uploadProgress.total > MAX_PHOTOS_PER_ADD && (
                  <Button variant="ghost" onPress={handleAbortUpload} testID="album-detail-upload-abort">
                    やめる
                  </Button>
                )}
              </View>
            )}
            {shareProgress && (
              <Text color="muted" align="center" testID="album-detail-share-progress">
                {`${shareProgress.done} / ${shareProgress.total} 枚を取得中…`}
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

      {/* 選択モードの下のバー: 「保存」（共有シートのある環境）「カバー」（1 枚のときだけ）「削除」（確認） */}
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
            <>
              {/* 042 1節: 21 枚以上選んでいるときは「保存」を押せなくして 1 行。選択には上限を掛けない（削除は何枚でも） */}
              {tooManyToShare && (
                <Text color="muted" align="center" testID="album-detail-share-limit">
                  {`一度に保存できるのは ${MAX_SHARE_FILES} 枚までです`}
                </Text>
              )}
              <View style={{ flexDirection: "row", gap: space.sm }}>
                {/* 042: 共有シートで保存できる環境だけ。タイムライン・ゲストはこれだけ。
                    ラベルは「保存」「カバー」「削除」（iPhone の幅では「保存（7 枚）」「カバーにする」が折れた。
                    枚数はヘッダーの「N 枚を選択中」にある。人間の決定 2026-09-14） */}
                {canShare && (
                  <View style={{ flex: 1 }}>
                    <Button
                      variant="secondary"
                      onPress={handleShareSelected}
                      disabled={selected.size === 0 || tooManyToShare || shareProgress !== null}
                      testID="album-detail-share"
                    >
                      保存
                    </Button>
                  </View>
                )}
                {canWrite && (
                  <>
                    <View style={{ flex: 1 }}>
                      <Button variant="secondary" onPress={handleSetCover} disabled={selected.size !== 1} testID="album-detail-set-cover">
                        カバー
                      </Button>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button variant="secondary" onPress={() => setConfirmingRemove(true)} disabled={selected.size === 0} testID="album-detail-remove">
                        削除
                      </Button>
                    </View>
                  </>
                )}
              </View>
            </>
          )}
        </View>
      )}

      {/* 045: 残りの警告（絵 01）。free で残りが 5 枚以下のとき、FAB の上に固定で出す
          （アルバムの写真は FAB から入れるので FAB の上。paid・ゲスト・タイムライン・選択中には出さない） */}
      {showQuotaWarning && albumQuota && (
        <View
          style={{
            position: "absolute",
            left: space.lg,
            right: space.lg,
            bottom: TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_MARGIN + space.md + FAB_SIZE + space.md,
          }}
        >
          <QuotaWarningCard quota={albumQuota} onPremium={() => router.push("/premium")} onDismiss={handleDismissWarning} />
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

      <PlanLimitSheet
        visible={planLimitOpen}
        onClose={() => setPlanLimitOpen(false)}
        onPremium={() => {
          setPlanLimitOpen(false);
          router.push("/premium");
        }}
      />

      <ImageViewer
        visible={viewerIndex !== null}
        images={viewerImages}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
        onEditCaption={canWrite ? openCaptionEditor : undefined}
      />

      {/* 048: ⋯ メニュー: ZIP で保存（タイムライン以外。ゲストも） */}
      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={title}>
        <View style={{ gap: space.sm }}>
          <Button
            variant="secondary"
            onPress={() => {
              setMenuOpen(false);
              setZipSource({ kind: "album", albumId, title });
            }}
            testID="album-detail-zip"
          >
            ZIP で保存
          </Button>
          <Button variant="ghost" onPress={() => setMenuOpen(false)}>
            閉じる
          </Button>
        </View>
      </Sheet>

      <ZipExportSheet source={zipSource} onClose={() => setZipSource(null)} />

      {/* 049: 20 枚超を選んだときの確認（送る前に 1 つ） */}
      <Sheet visible={uploadConfirm !== null} onClose={() => setUploadConfirm(null)} title="写真を追加">
        {uploadConfirm && (
          <View style={{ gap: space.md }}>
            <Text align="center" testID="album-detail-upload-confirm">
              {`${uploadConfirm.length} 枚を送ります。少し時間がかかります`}
            </Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button variant="ghost" onPress={() => setUploadConfirm(null)}>
                  キャンセル
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button onPress={() => runUpload(uploadConfirm)} testID="album-detail-upload-start">
                  送る
                </Button>
              </View>
            </View>
          </View>
        )}
      </Sheet>

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
