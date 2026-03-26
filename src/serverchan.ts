import axios from "axios";
import { config } from "./config.js";

export async function sendNotification(title: string, content: string): Promise<void> {
  // 优先构建新版 Push URL，若无则使用老版 ServerChan URL
  let url = "";
  if (config.ftqqPushKey) {
    url = `https://11310.push.ft07.com/send/${config.ftqqPushKey}.send`;
  } else if (config.serverChanSendKey) {
    url = `https://sctapi.ftqq.com/${config.serverChanSendKey}.send`;
  }
  
  if (!url) {
    console.warn("No notification URL configured.");
    return;
  }

  try {
    const response = await axios.post(url, {
      title,
      desp: content,
      tags: "Polymarket"
    }, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });

    if (response.data.data?.error === "SUCCESS" || response.data.code === 0) {
      console.log(`Notification sent successfully.`);
    } else {
      throw new Error(`Failed to send notification: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const errMsg = `Error sending notification (Status ${error.response.status}): ${JSON.stringify(error.response.data)}`;
      console.error(errMsg);
      throw new Error(errMsg);
    } else {
      const errMsg = `Error sending notification: ${error instanceof Error ? error.message : String(error)}`;
      console.error(errMsg);
      throw new Error(errMsg);
    }
  }
}
