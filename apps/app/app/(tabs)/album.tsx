import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import type { Album, Photo } from "@futary/contract";
import { TIMELINE_ALBUM_ID, TIMELINE_PREVIEW_COUNT } from "@futary/contract";
import { formatYearMonthSlash, todayJst } from "@futary/date";
import { Badge, Button, radius, Screen, space, Text, useTheme } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigation, useRouter } from "expo-router";
import { AlbumForm, type AlbumFormValues } from "../../components/album-form";
import { PlanLimitSheet } from "../../components/plan-limit-sheet";
import { Sheet } from "../../components/sheet";
import { UsageCard } from "../../components/usage-card";
import { pickAlbumImages, uploadAlbumImages } from "../../lib/album-upload";
import { useGuestMode } from "../../lib/guest-mode";
import type { SourceImage } from "../../lib/image";
import { orpc } from "../../lib/orpc";
import { albumQuotaRemaining } from "../../lib/plan";
import { queryClient } from "../../lib/query";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

// 041: アルバムの一覧。上にタイムライン（仮想・自動）の大きなカード、下にアルバムの 2 列グリッド
// （モックの絵。検索窓は置かない。タスク定義0節 #5）。ピンクは既存の部品に任せる（appearance を読まない）

const GRID_COLUMNS = 2;
const GRID_GAP = space.md;

export function albumDetailHref(id: string): string {
  return `/album-detail?id=${encodeURIComponent(id)}`;
}

// 期間は startDate の年月（無ければ createdAt の年月。タスク定義3節）
function periodLabel(album: Album): string {
  return formatYearMonthSlash(album.startDate ?? todayJst(album.createdAt * 1000));
}

// --- タイムラインのカード ---------------------------------------------

function TimelineCard({ photoCount, previews, onPress }: { photoCount: number; previews: Photo[]; onPress: () => void }) {
  const { colors } = useTheme();
  const [first, ...rest] = previews;
  // 写真が 4 枚未満なら右の列を空ける（枠を出さない。タスク定義3節）
  const showSideColumn = previews.length >= TIMELINE_PREVIEW_COUNT;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="タイムライン"
      testID="album-timeline-card"
      style={{ flexDirection: "row", gap: space.sm }}
    >
      <View
        style={{
          flex: 3,
          aspectRatio: 1,
          borderRadius: radius.card,
          backgroundColor: colors.surfaceTint,
          overflow: "hidden",
          justifyContent: "flex-end",
        }}
      >
        {first && (
          <Image
            source={{ uri: first.url }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        )}
        <View style={{ position: "absolute", top: space.md, right: space.md }}>
          <Badge>
            <Text size="xs" color="muted">
              自動
            </Text>
          </Badge>
        </View>
        <View style={{ padding: space.lg, gap: space.xs, backgroundColor: first ? colors.overlay : "transparent" }}>
          <Text size="lg" weight="bold" color={first ? "inverse" : "default"}>
            タイムライン
          </Text>
          <Text size="sm" color={first ? "inverse" : "muted"}>
            {photoCount === 0 ? "まだ写真がありません" : `${photoCount} 枚`}
          </Text>
        </View>
      </View>
      {showSideColumn && (
        <View style={{ flex: 1, gap: space.sm }}>
          {rest.slice(0, TIMELINE_PREVIEW_COUNT - 1).map((photo) => (
            <View
              key={photo.url}
              style={{ flex: 1, aspectRatio: 1, borderRadius: radius.input, overflow: "hidden", backgroundColor: colors.surfaceTint }}
            >
              <Image source={{ uri: photo.url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

// --- アルバムのカード ---------------------------------------------

function AlbumCard({ album, width, onPress, onOpenMenu }: { album: Album; width: number | undefined; onPress: () => void; onOpenMenu?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: width ?? "48%" }}>
      <Pressable
        testID={`album-card-${album.id}`}
        accessibilityRole="button"
        accessibilityLabel={album.title}
        onPress={onPress}
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.input,
          borderWidth: 1,
          borderColor: colors.border,
          padding: space.sm,
          gap: space.xs,
        }}
      >
        {/* カバーが無い（写真 0 枚）なら surface-tint の四角（040 と同じ。アイコンも絵文字も置かない） */}
        <View style={{ width: "100%", aspectRatio: 1, borderRadius: radius.input, backgroundColor: colors.surfaceTint, overflow: "hidden" }}>
          {album.cover && (
            <Image
              testID={`album-cover-${album.id}`}
              source={{ uri: album.cover.url }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="bold" numberOfLines={1}>
              {album.title}
            </Text>
            <Text size="xs" color="muted">
              {`${album.photoCount} 枚`}
            </Text>
            <Text size="xs" color="muted">
              {periodLabel(album)}
            </Text>
          </View>
          {/* ⋯: 編集・削除。ゲストは出さない */}
          {onOpenMenu && (
            <Button variant="ghost" onPress={onOpenMenu} accessibilityLabel={`${album.title} のメニュー`}>
              ⋯
            </Button>
          )}
        </View>
      </Pressable>
    </View>
  );
}

// --- 画面 ---------------------------------------------

export default function AlbumScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { isGuestMode } = useGuestMode();

  // queryKey に viewerKey を含める理由は apps/app/lib/viewer-key.ts 参照（T10）
  const viewerKey = useViewerQueryKey();
  const listOptions = orpc.album.list.queryOptions({ input: {} });
  const query = useQuery({ ...listOptions, queryKey: [...listOptions.queryKey, viewerKey] });
  // 045: 作成モーダルの「カバー写真を選択」で無料枠を見る（枠は couple.get から。一覧には出さない）
  const coupleOptions = orpc.couple.get.queryOptions();
  const coupleQuery = useQuery({ ...coupleOptions, queryKey: [...coupleOptions.queryKey, viewerKey], enabled: !isGuestMode });
  const albumQuota = coupleQuery.data?.albumQuota ?? null;
  const quotaRemaining = albumQuota ? albumQuotaRemaining(albumQuota) : null;
  const [planLimitOpen, setPlanLimitOpen] = useState(false);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.album.list.key() }),
      // 045: cover 付きで作ると枠の used が変わる
      queryClient.invalidateQueries({ queryKey: orpc.couple.get.key() }),
    ]);
  const requestUploadUrl = useMutation(orpc.album.uploadUrl.mutationOptions());
  const createAlbum = useMutation(orpc.album.create.mutationOptions({ onSuccess: invalidate }));
  const updateAlbum = useMutation(orpc.album.update.mutationOptions({ onSuccess: invalidate }));
  const deleteAlbum = useMutation(orpc.album.delete.mutationOptions({ onSuccess: invalidate }));

  const [gridWidth, setGridWidth] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [pickedCover, setPickedCover] = useState<SourceImage | null>(null);
  const [menuFor, setMenuFor] = useState<Album | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState<Album | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canWrite = !isGuestMode;
  const cardWidth = gridWidth > 0 ? (gridWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS : undefined;

  // + はヘッダー右（モックの絵。FAB にしない。FAB は投稿のもの。タスク定義3節）。ゲストは出さない
  useEffect(() => {
    navigation.setOptions({
      headerRight: canWrite
        ? () => (
            <Pressable
              onPress={() => setIsCreating(true)}
              accessibilityRole="button"
              accessibilityLabel="アルバムを作る"
              hitSlop={space.sm}
              style={{ paddingHorizontal: space.lg }}
            >
              <Text size="xl" color="brand">
                ＋
              </Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, canWrite]);

  function closeCreate() {
    setIsCreating(false);
    setPickedCover(null);
  }

  // 「作成」で閉じて詳細へ進む（作ったら次は写真を入れる。タスク定義3節）。
  // カバーがあれば署名付き PUT で送ってから album.create の cover に渡す
  async function handleCreate(values: AlbumFormValues) {
    let cover: { imageId: string; width: number; height: number } | undefined;
    if (pickedCover) {
      const [uploaded] = await uploadAlbumImages([pickedCover], (contentType) => requestUploadUrl.mutateAsync({ contentType }));
      if (uploaded) cover = { imageId: uploaded.imageId, width: uploaded.imageWidth, height: uploaded.imageHeight };
    }
    let created;
    try {
      created = await createAlbum.mutateAsync({
        title: values.title,
        note: values.note === "" ? undefined : values.note,
        startDate: values.startDate === "" ? undefined : values.startDate,
        endDate: values.endDate === "" ? undefined : values.endDate,
        cover,
      });
    } catch (error) {
      // 045: 相手が同時に足した等でサーバが PLAN_LIMIT を返したら、モーダルを閉じて同じシート
      if (error instanceof ORPCError && error.code === "PLAN_LIMIT") {
        closeCreate();
        setPlanLimitOpen(true);
        void queryClient.invalidateQueries({ queryKey: orpc.couple.get.key() });
        return;
      }
      throw error;
    }
    closeCreate();
    router.push(albumDetailHref(created.id));
  }

  async function handleUpdate(album: Album, values: AlbumFormValues) {
    await updateAlbum.mutateAsync({
      id: album.id,
      title: values.title,
      note: values.note,
      startDate: values.startDate === "" ? null : values.startDate,
      endDate: values.endDate === "" ? null : values.endDate,
    });
    setEditing(null);
  }

  function closeMenu() {
    setMenuFor(null);
    setConfirmingDelete(false);
  }

  async function handleDelete(album: Album) {
    setErrorMessage(null);
    try {
      await deleteAlbum.mutateAsync({ id: album.id });
    } catch {
      setErrorMessage("削除できませんでした。もう一度お試しください");
    }
    closeMenu();
  }

  const albums = query.data?.items ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.md }}>
        {errorMessage && <Text color="muted">{errorMessage}</Text>}

        {query.isLoading ? (
          <View style={{ alignItems: "center", padding: space.xl }}>
            <Text color="muted">読み込み中…</Text>
          </View>
        ) : query.isError ? (
          <View style={{ alignItems: "center", gap: space.md, padding: space.xl }}>
            <Text color="muted">読み込めませんでした</Text>
            <Button
              variant="secondary"
              onPress={async () => {
                await query.refetch();
              }}
            >
              再試行
            </Button>
          </View>
        ) : (
          <>
            {/* タイムラインのカードは写真 0 枚でも出す（入口を消さない） */}
            <TimelineCard
              photoCount={query.data?.timeline.photoCount ?? 0}
              previews={query.data?.timeline.previews ?? []}
              onPress={() => router.push(albumDetailHref(TIMELINE_ALBUM_ID))}
            />

            {albums.length === 0 ? (
              <View style={{ alignItems: "center", padding: space.xl }}>
                <Text color="muted">イベントごとに写真をまとめられます</Text>
              </View>
            ) : (
              <View
                onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
                style={{ flexDirection: "row", flexWrap: "wrap", columnGap: GRID_GAP, rowGap: GRID_GAP }}
              >
                {albums.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    width={cardWidth}
                    onPress={() => router.push(albumDetailHref(album.id))}
                    onOpenMenu={canWrite ? () => setMenuFor(album) : undefined}
                  />
                ))}
              </View>
            )}

            {/* 045: 写真の使用量（絵 05）。一覧の一番下（人間の指示。2026-09-14）。
                free のときだけ（paid は null。ゲストは couple.get を読まない） */}
            {canWrite && albumQuota && <UsageCard quota={albumQuota} onPremium={() => router.push("/premium")} />}
          </>
        )}
      </ScrollView>

      {/* 作成 */}
      <Sheet visible={isCreating} onClose={closeCreate} title="新しいアルバム">
        {isCreating && (
          <AlbumForm
            mode="create"
            initial={{ title: "", startDate: "", endDate: "", note: "" }}
            onSubmit={handleCreate}
            onCancel={closeCreate}
            pickedCover={pickedCover}
            onPickCover={async () => {
              // 045: 残りが 0 なら選ばせず、作成モーダルを閉じてシート（写真を選ばせない）
              if (quotaRemaining === 0) {
                closeCreate();
                setPlanLimitOpen(true);
                return;
              }
              const [source] = await pickAlbumImages(1);
              if (source) setPickedCover(source);
            }}
            onRemoveCover={() => setPickedCover(null)}
          />
        )}
      </Sheet>

      <PlanLimitSheet
        visible={planLimitOpen}
        onClose={() => setPlanLimitOpen(false)}
        onPremium={() => {
          setPlanLimitOpen(false);
          router.push("/premium");
        }}
      />

      {/* 編集 */}
      <Sheet visible={editing !== null} onClose={() => setEditing(null)} title="アルバムを編集">
        {editing && (
          <AlbumForm
            mode="edit"
            initial={{ title: editing.title, startDate: editing.startDate ?? "", endDate: editing.endDate ?? "", note: editing.note }}
            onSubmit={(values) => handleUpdate(editing, values)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Sheet>

      {/* ⋯ メニュー: 編集・削除（確認を挟む） */}
      <Sheet visible={menuFor !== null} onClose={closeMenu} title={menuFor?.title ?? ""}>
        {menuFor && (
          <View style={{ gap: space.sm }}>
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
              <View style={{ gap: space.sm }}>
                <Text color="muted">アルバムを削除しますか？ 中の写真も消えます</Text>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button variant="ghost" onPress={() => setConfirmingDelete(false)}>
                      キャンセル
                    </Button>
                  </View>
                  <View style={{ flex: 1 }}>
                    {/* danger は退会専用（036）。削除の確認は list.tsx・want.tsx と同じ secondary */}
                    <Button variant="secondary" onPress={() => handleDelete(menuFor)}>
                      削除する
                    </Button>
                  </View>
                </View>
              </View>
            ) : (
              <Button variant="ghost" onPress={() => setConfirmingDelete(true)}>
                削除
              </Button>
            )}
            <Button variant="ghost" onPress={closeMenu}>
              閉じる
            </Button>
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
