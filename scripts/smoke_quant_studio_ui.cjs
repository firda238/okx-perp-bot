const { chromium } = require("../.cache/pw/node_modules/playwright");

const baseUrl = process.env.QUANT_STUDIO_URL || "http://127.0.0.1:5173/";

async function expectText(page, text, label = text) {
  const found = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
  if (!found) throw new Error(`Missing UI text: ${label}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "策略", exact: true }).waitFor({ state: "visible", timeout: 10000 });

  await page.getByRole("button", { name: "打开通知中心" }).click();
  await expectText(page, "通知中心");
  await expectText(page, "OKX 密钥");
  await expectText(page, "打开实盘");
  await page.getByRole("button", { name: /OKX .*/ }).click();
  await expectText(page, "实盘动作队列");
  await expectText(page, "提交确认控制台");

  const search = page.getByPlaceholder("搜索策略、指标、市场或数据...");
  await search.fill("数据");
  await expectText(page, "打开工作区", "search result");
  await page.getByRole("button", { name: /数据\s+打开工作区/ }).click();
  await expectText(page, "数据健康诊断", "data workspace");
  await expectText(page, "任务详情");
  await expectText(page, "Task Raw JSON");
  await expectText(page, "缓存详情");
  await expectText(page, "Cache Raw JSON");

  await page.getByRole("button", { name: "策略", exact: true }).click();
  await expectText(page, "策略动作队列");
  await expectText(page, "信号证据矩阵");
  await expectText(page, "Signal Evidence JSON");
  await page.getByRole("button", { name: "市场", exact: true }).click();
  await expectText(page, "市场证据矩阵");
  await expectText(page, "Market Evidence JSON");
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("button", { name: "风控", exact: true }).click();
  await expectText(page, "准入证据矩阵");
  await expectText(page, "Readiness Evidence JSON");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expectText(page, "系统证据");
  await expectText(page, "System Evidence JSON");
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("button", { name: "回测", exact: true }).click();
  await expectText(page, "回测归因复盘");
  await expectText(page, "Attribution Raw JSON");
  await expectText(page, "参数变化");
  await page.getByRole("button", { name: "交易分析", exact: true }).click();
  await expectText(page, "交易证据矩阵");
  await expectText(page, "Trade Evidence JSON");
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByRole("button", { name: "展开图表" }).click();
  const expanded = await page.locator(".chart-panel.is-expanded").isVisible();
  if (!expanded) throw new Error("Chart did not enter expanded mode");
  await page.getByRole("button", { name: "退出图表全屏" }).click();

  await page.getByRole("button", { name: "实盘", exact: true }).click();
  await expectText(page, "实盘动作队列");
  await expectText(page, "提交确认控制台");
  await expectText(page, "确认短语锁测试");
  await expectText(page, "刷新执行账本");
  await expectText(page, "账本详情");
  await expectText(page, "Payload / Gate JSON");
  const detailButtons = await page.getByRole("button", { name: "详情" }).count();
  if (detailButtons > 0) {
    await page.getByRole("button", { name: "详情" }).first().click();
    await expectText(page, "Final Gate 检查");
  }

  if (errors.length) {
    throw new Error(`Browser errors:\n${errors.join("\n")}`);
  }
  await browser.close();
  console.log(`OK UI smoke passed: ${baseUrl}`);
}

main().catch(async (error) => {
  console.error(error.message);
  process.exit(1);
});
