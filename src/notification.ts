import axios from "axios";
import { config } from "./config.js";

/**
 * 发送 ServerChan/Push 通知
 * @param title 标题
 * @param content 内容
 */
export async function sendNotification(title: string, content: string): Promise<void> {
  const url = config.ftqqPushUrl || `https://sctapi.ftqq.com/${config.serverChanSendKey}.send`;
  
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
      console.error(`Failed to send notification: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error(`Error sending notification (Status ${error.response.status}):`, error.response.data);
    } else {
      console.error(`Error sending notification:`, error instanceof Error ? error.message : error);
    }
  }
}
