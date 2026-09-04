import { useState } from "react";
import { Image, Pressable, ScrollView, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Button, colors, radius, Screen, space, Text } from "@futary/ui";
import { MAX_POST_IMAGES } from "@futary/contract";
import { compressImage, uploadCompressedImage, type SourceImage } from "../lib/image";
import { useGuestMode } from "../lib/guest-mode";
import { orpc } from "../lib/orpc";
import { queryClient } from "../lib/query";

const MAX_BODY_LENGTH = 2000;
const THUMBNAIL_SIZE = 80;

export default function ComposeScreen() {
  const router = useRouter();
  const { isGuestMode, exitGuestMode } = useGuestMode();
  const [body, setBody] = useState("");
  // 031: 1投稿に画像を4枚まで。選んだ順がそのまま並び順になる
  const [images, setImages] = useState<SourceImage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestUploadUrl = useMutation(orpc.post.uploadUrl.mutationOptions());
  const createPost = useMutation(
    orpc.post.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.post.list.key() }),
    }),
  );

  const trimmedBody = body.trim();
  // post.create の下限（本文か画像のどちらかは必須。architecture.md 5節）と揃える
  const canSubmit = trimmedBody.length > 0 || images.length > 0;
  const isSubmitting = requestUploadUrl.isPending || createPost.isPending;
  const canAddMore = images.length < MAX_POST_IMAGES;

  // 014: FAB・タイムラインの空状態からはゲスト閲覧中にここへ来ないよう
  // ガード済みだが、Webでは /compose を直接開かれる経路が残る
  // （security-auditor指摘）。サーバ側のFORBIDDENが唯一の防御線であることに
  // 変わりはないが、他の画面と同じくログイン導線に差し替える
  if (isGuestMode) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}>
          <Text weight="bold">投稿はログインすると使えます</Text>
          <Button onPress={exitGuestMode}>ログイン</Button>
        </View>
      </Screen>
    );
  }

  // 031: 上限（4枚）まで、複数選択した分だけ足す。省略を作らない設計
  // （タスク定義1節）と対になり、そもそも4枚を超えて選ばせない
  async function pickImages() {
    const remaining = MAX_POST_IMAGES - images.length;
    if (remaining <= 0) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (result.canceled) return;

    const picked = result.assets
      .slice(0, remaining)
      .map((asset) => ({ uri: asset.uri, width: asset.width, height: asset.height, mimeType: asset.mimeType }));
    setImages((prev) => [...prev, ...picked]);
  }

  function removeImageAt(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  // Button 自体が二重発火を防ぐ（conventions.md 4節）。ここでは
  // アップロード〜投稿作成の一連の流れをまとめて1つの onPress にする
  async function handleSubmit() {
    if (!canSubmit) return;
    setErrorMessage(null);

    try {
      // 031: post.uploadUrl は枚数ぶん呼ぶ。並行してよい（タスク定義5節）
      const uploaded = await Promise.all(
        images.map(async (image) => {
          const compressed = await compressImage(image);
          return uploadCompressedImage(
            (contentType) => requestUploadUrl.mutateAsync({ contentType }),
            compressed,
          );
        }),
      );

      await createPost.mutateAsync({
        body: trimmedBody,
        images: uploaded.map((u) => ({ imageId: u.imageId, width: u.imageWidth, height: u.imageHeight })),
      });
      router.back();
    } catch {
      setErrorMessage("投稿できませんでした。もう一度お試しください");
    }
  }

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {/* 画像プレビュー（特に縦長写真）が画面の高さを超えると、下の投稿ボタンが
            画面外に押し出されて押せなくなっていた。スクロール可能にし、
            投稿ボタンは常に押せる位置（画面下部固定）に分離する */}
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="今日の出来事を書く"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={MAX_BODY_LENGTH}
            style={{
              minHeight: 120,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.input,
              padding: space.md,
              fontSize: 16,
              color: colors.text,
              textAlignVertical: "top",
            }}
          />

          {images.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {images.map((image, index) => (
                <View key={`${image.uri}-${index}`} style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}>
                  <Image
                    source={{ uri: image.uri }}
                    style={{ width: "100%", height: "100%", borderRadius: radius.input }}
                    resizeMode="cover"
                  />
                  <Pressable
                    onPress={() => removeImageAt(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`${index + 1}枚目の画像を外す`}
                    hitSlop={space.xs}
                    style={{
                      position: "absolute",
                      top: -space.xs,
                      right: -space.xs,
                      backgroundColor: colors.overlay,
                      borderRadius: radius.input,
                      width: 22,
                      height: 22,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text color="inverse" size="xs">
                      ×
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {canAddMore && (
            <Button variant="secondary" onPress={pickImages}>
              {images.length > 0 ? "画像を追加する" : "画像を選ぶ"}
            </Button>
          )}

          {errorMessage && <Text color="muted">{errorMessage}</Text>}
        </ScrollView>

        <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg }}>
          {/* モーダルは閉じる導線を自前で持つ（headerShownのヘッダー戻るに
              依存しない。Webでは確実に出るとは限らないため。
              architecture.md「画面の外枠は常に出す」の規則と同じ考え方） */}
          <View style={{ flex: 1 }}>
            <Button variant="ghost" onPress={() => router.back()}>
              キャンセル
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button onPress={handleSubmit} disabled={!canSubmit}>
              {isSubmitting ? "投稿中…" : "投稿する"}
            </Button>
          </View>
        </View>
      </View>
    </Screen>
  );
}
