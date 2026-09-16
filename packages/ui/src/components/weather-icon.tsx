import { Image, View } from "react-native";
import { weatherCloud, weatherRain, weatherSnow, weatherSun, weatherThunder } from "../assets";
import { weatherIconsOf, type WeatherIconKind } from "../weather-codes";

// 058: 天気コードの絵（主 + 副。タスク定義 0節 #7）。主は size、副は右下に size × 0.57（28 と 16 の比）で重ねる。
// 表に無いコードは主 = 曇（weatherIconsOf）

const SOURCES: Record<WeatherIconKind, number> = {
  sun: weatherSun,
  cloud: weatherCloud,
  rain: weatherRain,
  snow: weatherSnow,
  thunder: weatherThunder,
};

export const WEATHER_ICON_SIZE = 28;
const SUB_RATIO = 16 / 28;

export type WeatherIconProps = {
  code: string;
  size?: number;
  testID?: string;
};

export function WeatherIcon({ code, size = WEATHER_ICON_SIZE, testID }: WeatherIconProps) {
  const icons = weatherIconsOf(code);
  const subSize = Math.round(size * SUB_RATIO);
  return (
    <View
      testID={testID}
      accessibilityLabel={icons.name}
      accessibilityRole="image"
      style={{ width: size, height: size }}
      {...({ dataSet: { weatherMain: icons.main, weatherSub: icons.sub ?? "" } } as object)}
    >
      <Image source={SOURCES[icons.main]} style={{ width: size, height: size }} resizeMode="contain" accessibilityIgnoresInvertColors />
      {icons.sub && (
        <Image
          source={SOURCES[icons.sub]}
          style={{ position: "absolute", right: -Math.round(subSize * 0.15), bottom: -Math.round(subSize * 0.15), width: subSize, height: subSize }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}
