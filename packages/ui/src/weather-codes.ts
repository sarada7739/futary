// 058: 気象庁の天気コード → 主 + 副の絵（タスク定義 0節 #7）。artifacts/058/scripts/make-tables.mjs が
// 予報ページの TELOPS（全コード）の日本語の名前から機械的に作る（手で直さない。作り直す）。
// 主 = 名前の最初の天気の語、副 = 次の違う語。雷を含めば副は雷。霧は曇、みぞれは雪。
// 表に無いコードは主 = 曇で倒す（weatherIconsOf）

export const WEATHER_ICON_KINDS = ["sun", "cloud", "rain", "snow", "thunder"] as const;
export type WeatherIconKind = (typeof WEATHER_ICON_KINDS)[number];

export interface WeatherIcons {
  name: string;
  main: WeatherIconKind;
  sub: WeatherIconKind | null;
}

export const WEATHER_CODES: Readonly<Record<string, WeatherIcons>> = {
  "100": {
    "name": "晴",
    "main": "sun",
    "sub": null
  },
  "101": {
    "name": "晴時々曇",
    "main": "sun",
    "sub": "cloud"
  },
  "102": {
    "name": "晴一時雨",
    "main": "sun",
    "sub": "rain"
  },
  "103": {
    "name": "晴時々雨",
    "main": "sun",
    "sub": "rain"
  },
  "104": {
    "name": "晴一時雪",
    "main": "sun",
    "sub": "snow"
  },
  "105": {
    "name": "晴時々雪",
    "main": "sun",
    "sub": "snow"
  },
  "106": {
    "name": "晴一時雨か雪",
    "main": "sun",
    "sub": "rain"
  },
  "107": {
    "name": "晴時々雨か雪",
    "main": "sun",
    "sub": "rain"
  },
  "108": {
    "name": "晴一時雨か雷雨",
    "main": "sun",
    "sub": "thunder"
  },
  "110": {
    "name": "晴後時々曇",
    "main": "sun",
    "sub": "cloud"
  },
  "111": {
    "name": "晴後曇",
    "main": "sun",
    "sub": "cloud"
  },
  "112": {
    "name": "晴後一時雨",
    "main": "sun",
    "sub": "rain"
  },
  "113": {
    "name": "晴後時々雨",
    "main": "sun",
    "sub": "rain"
  },
  "114": {
    "name": "晴後雨",
    "main": "sun",
    "sub": "rain"
  },
  "115": {
    "name": "晴後一時雪",
    "main": "sun",
    "sub": "snow"
  },
  "116": {
    "name": "晴後時々雪",
    "main": "sun",
    "sub": "snow"
  },
  "117": {
    "name": "晴後雪",
    "main": "sun",
    "sub": "snow"
  },
  "118": {
    "name": "晴後雨か雪",
    "main": "sun",
    "sub": "rain"
  },
  "119": {
    "name": "晴後雨か雷雨",
    "main": "sun",
    "sub": "thunder"
  },
  "120": {
    "name": "晴朝夕一時雨",
    "main": "sun",
    "sub": "rain"
  },
  "121": {
    "name": "晴朝の内一時雨",
    "main": "sun",
    "sub": "rain"
  },
  "122": {
    "name": "晴夕方一時雨",
    "main": "sun",
    "sub": "rain"
  },
  "123": {
    "name": "晴山沿い雷雨",
    "main": "sun",
    "sub": "thunder"
  },
  "124": {
    "name": "晴山沿い雪",
    "main": "sun",
    "sub": "snow"
  },
  "125": {
    "name": "晴午後は雷雨",
    "main": "sun",
    "sub": "thunder"
  },
  "126": {
    "name": "晴昼頃から雨",
    "main": "sun",
    "sub": "rain"
  },
  "127": {
    "name": "晴夕方から雨",
    "main": "sun",
    "sub": "rain"
  },
  "128": {
    "name": "晴夜は雨",
    "main": "sun",
    "sub": "rain"
  },
  "130": {
    "name": "朝の内霧後晴",
    "main": "cloud",
    "sub": "sun"
  },
  "131": {
    "name": "晴明け方霧",
    "main": "sun",
    "sub": "cloud"
  },
  "132": {
    "name": "晴朝夕曇",
    "main": "sun",
    "sub": "cloud"
  },
  "140": {
    "name": "晴時々雨で雷を伴う",
    "main": "sun",
    "sub": "thunder"
  },
  "160": {
    "name": "晴一時雪か雨",
    "main": "sun",
    "sub": "snow"
  },
  "170": {
    "name": "晴時々雪か雨",
    "main": "sun",
    "sub": "snow"
  },
  "181": {
    "name": "晴後雪か雨",
    "main": "sun",
    "sub": "snow"
  },
  "200": {
    "name": "曇",
    "main": "cloud",
    "sub": null
  },
  "201": {
    "name": "曇時々晴",
    "main": "cloud",
    "sub": "sun"
  },
  "202": {
    "name": "曇一時雨",
    "main": "cloud",
    "sub": "rain"
  },
  "203": {
    "name": "曇時々雨",
    "main": "cloud",
    "sub": "rain"
  },
  "204": {
    "name": "曇一時雪",
    "main": "cloud",
    "sub": "snow"
  },
  "205": {
    "name": "曇時々雪",
    "main": "cloud",
    "sub": "snow"
  },
  "206": {
    "name": "曇一時雨か雪",
    "main": "cloud",
    "sub": "rain"
  },
  "207": {
    "name": "曇時々雨か雪",
    "main": "cloud",
    "sub": "rain"
  },
  "208": {
    "name": "曇一時雨か雷雨",
    "main": "cloud",
    "sub": "thunder"
  },
  "209": {
    "name": "霧",
    "main": "cloud",
    "sub": null
  },
  "210": {
    "name": "曇後時々晴",
    "main": "cloud",
    "sub": "sun"
  },
  "211": {
    "name": "曇後晴",
    "main": "cloud",
    "sub": "sun"
  },
  "212": {
    "name": "曇後一時雨",
    "main": "cloud",
    "sub": "rain"
  },
  "213": {
    "name": "曇後時々雨",
    "main": "cloud",
    "sub": "rain"
  },
  "214": {
    "name": "曇後雨",
    "main": "cloud",
    "sub": "rain"
  },
  "215": {
    "name": "曇後一時雪",
    "main": "cloud",
    "sub": "snow"
  },
  "216": {
    "name": "曇後時々雪",
    "main": "cloud",
    "sub": "snow"
  },
  "217": {
    "name": "曇後雪",
    "main": "cloud",
    "sub": "snow"
  },
  "218": {
    "name": "曇後雨か雪",
    "main": "cloud",
    "sub": "rain"
  },
  "219": {
    "name": "曇後雨か雷雨",
    "main": "cloud",
    "sub": "thunder"
  },
  "220": {
    "name": "曇朝夕一時雨",
    "main": "cloud",
    "sub": "rain"
  },
  "221": {
    "name": "曇朝の内一時雨",
    "main": "cloud",
    "sub": "rain"
  },
  "222": {
    "name": "曇夕方一時雨",
    "main": "cloud",
    "sub": "rain"
  },
  "223": {
    "name": "曇日中時々晴",
    "main": "cloud",
    "sub": "sun"
  },
  "224": {
    "name": "曇昼頃から雨",
    "main": "cloud",
    "sub": "rain"
  },
  "225": {
    "name": "曇夕方から雨",
    "main": "cloud",
    "sub": "rain"
  },
  "226": {
    "name": "曇夜は雨",
    "main": "cloud",
    "sub": "rain"
  },
  "228": {
    "name": "曇昼頃から雪",
    "main": "cloud",
    "sub": "snow"
  },
  "229": {
    "name": "曇夕方から雪",
    "main": "cloud",
    "sub": "snow"
  },
  "230": {
    "name": "曇夜は雪",
    "main": "cloud",
    "sub": "snow"
  },
  "231": {
    "name": "曇海上海岸は霧か霧雨",
    "main": "cloud",
    "sub": "rain"
  },
  "240": {
    "name": "曇時々雨で雷を伴う",
    "main": "cloud",
    "sub": "thunder"
  },
  "250": {
    "name": "曇時々雪で雷を伴う",
    "main": "cloud",
    "sub": "thunder"
  },
  "260": {
    "name": "曇一時雪か雨",
    "main": "cloud",
    "sub": "snow"
  },
  "270": {
    "name": "曇時々雪か雨",
    "main": "cloud",
    "sub": "snow"
  },
  "281": {
    "name": "曇後雪か雨",
    "main": "cloud",
    "sub": "snow"
  },
  "300": {
    "name": "雨",
    "main": "rain",
    "sub": null
  },
  "301": {
    "name": "雨時々晴",
    "main": "rain",
    "sub": "sun"
  },
  "302": {
    "name": "雨時々止む",
    "main": "rain",
    "sub": null
  },
  "303": {
    "name": "雨時々雪",
    "main": "rain",
    "sub": "snow"
  },
  "304": {
    "name": "雨か雪",
    "main": "rain",
    "sub": "snow"
  },
  "306": {
    "name": "大雨",
    "main": "rain",
    "sub": null
  },
  "308": {
    "name": "雨で暴風を伴う",
    "main": "rain",
    "sub": null
  },
  "309": {
    "name": "雨一時雪",
    "main": "rain",
    "sub": "snow"
  },
  "311": {
    "name": "雨後晴",
    "main": "rain",
    "sub": "sun"
  },
  "313": {
    "name": "雨後曇",
    "main": "rain",
    "sub": "cloud"
  },
  "314": {
    "name": "雨後時々雪",
    "main": "rain",
    "sub": "snow"
  },
  "315": {
    "name": "雨後雪",
    "main": "rain",
    "sub": "snow"
  },
  "316": {
    "name": "雨か雪後晴",
    "main": "rain",
    "sub": "snow"
  },
  "317": {
    "name": "雨か雪後曇",
    "main": "rain",
    "sub": "snow"
  },
  "320": {
    "name": "朝の内雨後晴",
    "main": "rain",
    "sub": "sun"
  },
  "321": {
    "name": "朝の内雨後曇",
    "main": "rain",
    "sub": "cloud"
  },
  "322": {
    "name": "雨朝晩一時雪",
    "main": "rain",
    "sub": "snow"
  },
  "323": {
    "name": "雨昼頃から晴",
    "main": "rain",
    "sub": "sun"
  },
  "324": {
    "name": "雨夕方から晴",
    "main": "rain",
    "sub": "sun"
  },
  "325": {
    "name": "雨夜は晴",
    "main": "rain",
    "sub": "sun"
  },
  "326": {
    "name": "雨夕方から雪",
    "main": "rain",
    "sub": "snow"
  },
  "327": {
    "name": "雨夜は雪",
    "main": "rain",
    "sub": "snow"
  },
  "328": {
    "name": "雨一時強く降る",
    "main": "rain",
    "sub": null
  },
  "329": {
    "name": "雨一時みぞれ",
    "main": "rain",
    "sub": "snow"
  },
  "340": {
    "name": "雪か雨",
    "main": "snow",
    "sub": "rain"
  },
  "350": {
    "name": "雨で雷を伴う",
    "main": "rain",
    "sub": "thunder"
  },
  "361": {
    "name": "雪か雨後晴",
    "main": "snow",
    "sub": "rain"
  },
  "371": {
    "name": "雪か雨後曇",
    "main": "snow",
    "sub": "rain"
  },
  "400": {
    "name": "雪",
    "main": "snow",
    "sub": null
  },
  "401": {
    "name": "雪時々晴",
    "main": "snow",
    "sub": "sun"
  },
  "402": {
    "name": "雪時々止む",
    "main": "snow",
    "sub": null
  },
  "403": {
    "name": "雪時々雨",
    "main": "snow",
    "sub": "rain"
  },
  "405": {
    "name": "大雪",
    "main": "snow",
    "sub": null
  },
  "406": {
    "name": "風雪強い",
    "main": "snow",
    "sub": null
  },
  "407": {
    "name": "暴風雪",
    "main": "snow",
    "sub": null
  },
  "409": {
    "name": "雪一時雨",
    "main": "snow",
    "sub": "rain"
  },
  "411": {
    "name": "雪後晴",
    "main": "snow",
    "sub": "sun"
  },
  "413": {
    "name": "雪後曇",
    "main": "snow",
    "sub": "cloud"
  },
  "414": {
    "name": "雪後雨",
    "main": "snow",
    "sub": "rain"
  },
  "420": {
    "name": "朝の内雪後晴",
    "main": "snow",
    "sub": "sun"
  },
  "421": {
    "name": "朝の内雪後曇",
    "main": "snow",
    "sub": "cloud"
  },
  "422": {
    "name": "雪昼頃から雨",
    "main": "snow",
    "sub": "rain"
  },
  "423": {
    "name": "雪夕方から雨",
    "main": "snow",
    "sub": "rain"
  },
  "425": {
    "name": "雪一時強く降る",
    "main": "snow",
    "sub": null
  },
  "426": {
    "name": "雪後みぞれ",
    "main": "snow",
    "sub": null
  },
  "427": {
    "name": "雪一時みぞれ",
    "main": "snow",
    "sub": null
  },
  "450": {
    "name": "雪で雷を伴う",
    "main": "snow",
    "sub": "thunder"
  }
};

export function weatherIconsOf(code: string): WeatherIcons {
  return WEATHER_CODES[code] ?? { name: "不明", main: "cloud", sub: null };
}
