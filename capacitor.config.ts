import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.smartnote.app",
  appName: "SmartNote",
  webDir: "dist",
  android: {
    // 디버그 빌드에서 컴퓨터의 크롬(chrome://inspect)으로 앱 화면을 검사할 수 있게
    webContentsDebuggingEnabled: true,
    backgroundColor: "#f4f4f4",
  },
};

export default config;
