import fs from "node:fs/promises";
import path from "node:path";

const STATE_FILE = path.join(process.cwd(), "state.json");

interface State {
  notifiedConditionIds: string[];
}

/**
 * 加载本地状态文件
 * @returns 已提醒的 conditionId 列表
 */
export async function loadState(): Promise<string[]> {
  try {
    const content = await fs.readFile(STATE_FILE, "utf-8");
    const data: State = JSON.parse(content);
    return data.notifiedConditionIds || [];
  } catch (error) {
    // 如果文件不存在，返回空列表
    return [];
  }
}

/**
 * 保存状态到本地文件
 * @param ids 当前发现并成功提醒的所有 conditionId 列表
 */
export async function saveState(ids: string[]): Promise<void> {
  const data: State = {
    notifiedConditionIds: ids,
  };
  await fs.writeFile(STATE_FILE, JSON.stringify(data, null, 2), "utf-8");
}
