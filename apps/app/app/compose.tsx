import { useState } from "react";
import { Image, Pressable, ScrollView, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Button, radius, Screen, space, Text, useTheme } from "@futary/ui";
import { MAX_POST_IMAGES } from "@futary/contract";
import { compressImage, uploadCompressedImage, type SourceImage } from "../lib/image";
import { useGuestMode } from "../lib/guest-mode";
import { orpc } from "../lib/orpc";
import { queryClient } from "../lib/query";

const MAX_BODY_LENGTH = 2000;
const THUMBNAIL_SIZE = 80;

export default function ComposeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { isGuestMode, exitGuestMode } = useGuestMode();
  const [body, setBody] = useState("");
  // 1 投稿に画像 4 枚まで。選んだ順がそのまま並び順
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

  // 導線は塞いであるが、Web では /compose を直接開ける。防御線はサーバの FORBIDDEN だが、他の画面と同じく
  // ログインの導線に替える
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

  // 4 枚まで、複数選択した分だけ足す（4 枚を超えて選ばせない）
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

  // Button 自体が二重発火を防ぐ（conventions.md 4節）。アップロードから投稿の作成までを 1 つの onPress にする
  async function handleSubmit() {
    if (!canSubmit) return;
    setErrorMessage(null);

    try {
      // post.uploadUrl は枚数ぶん呼ぶ（並行でよい）
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
        {/* 縦長の写真で投稿ボタンが画面外に押し出されないよう、中身はスクロールさせ、ボタンは下に固定する */}
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
          {/* モーダルは閉じる導線を自分で持つ（Web ではヘッダーの戻るが出るとは限らない） */}
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
