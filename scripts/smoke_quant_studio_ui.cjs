const { chromium } = require("../.cache/pw/node_modules/playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.QUANT_STUDIO_URL || "http://127.0.0.1:5173/";
const screenshotPath = process.env.QUANT_STUDIO_SMOKE_SCREENSHOT || path.resolve(__dirname, "../output/playwright/quant-live-smoke.png");

async function expectText(page, text, label = text) {
  const locator = page.getByText(text, { exact: false }).first();
  const found = await locator.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
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
  await expectText(page, "账户收益曲线", "account equity homepage");
  await expectText(page, "当前权益", "current equity metric");
  await expectText(page, "2026-06-06 00:00 固定起点", "fixed june 6 account equity anchor");
  await expectText(page, "2026-06-06起累计盈亏", "anchored pnl metric");
  await expectText(page, "每 15分钟", "fixed 15m equity interval");
  await expectText(page, "自动化自检", "automation preflight status");
  await expectText(page, "自动化阶段", "automation readiness stage");
  await expectText(page, "自检心跳", "automation heartbeat status");
  await expectText(page, "心跳历史", "automation heartbeat history");
  await expectText(page, "自检历史", "automation preflight history");
  await expectText(page, "最近回测证据", "recent backtest evidence on homepage");
  await expectText(page, "上线阻断项", "homepage rollout blockers");
  await expectText(page, "运行自检", "manual automation preflight action");
  await expectText(page, "后续工作区", "branch summary below homepage");
  await expectText(page, "实盘锁定", "topbar live lock chip");
  await expectText(page, "OKX", "topbar okx status chip");

  await page.getByRole("button", { name: "打开通知中心" }).click();
  await expectText(page, "通知中心");
  await expectText(page, "系统建议");
  await expectText(page, "打开实盘");
  await page.getByRole("button", { name: "实盘", exact: true }).click();
  await expectText(page, "只读就绪", "live readiness readonly card");
  await expectText(page, "Canary复核", "live readiness canary card");
  await expectText(page, "证据检查", "live readiness evidence card");
  await expectText(page, "Readiness状态", "live readiness status card");
  await expectText(page, "dry_run_only=true", "live readiness dry-run lock");
  await expectText(page, "can_submit_live=false", "live readiness submit lock");
  await expectText(page, "实盘前闸门", "pre-live gate panel");
  await expectText(page, "NO-GO", "pre-live no-go status");
  await expectText(page, "真实提交人工解锁", "manual live-submit unlock blocker");
  await expectText(page, "Readiness快照历史", "live readiness snapshot history");
  await expectText(page, "快照实盘锁", "live readiness snapshot lock");
  await expectText(page, "实盘动作队列");
  await expectText(page, "提交确认控制台");
  await expectText(page, "macOS Keychain", "keychain persistence option");
  await expectText(page, "Keychain恢复状态", "keychain recovery feedback");
  await expectText(page, "secrets-status", "keychain read-only status command");
  await expectText(page, "保存并写入Keychain", "keychain default save button");
  await expectText(page, "默认写入Keychain", "keychain default persistence label");
  await expectText(page, "Keychain导入阻断", "keychain missing blocker");
  await expectText(page, "三项 OKX Keychain 已读回确认", "keychain verification blocker guidance");
  await expectText(page, "import-secrets --restart", "keychain restart import command");

  const search = page.getByPlaceholder("搜索策略、指标、市场或数据...");
  await search.fill("数据");
  await expectText(page, "打开工作区", "search result");
  await page.getByRole("button", { name: /数据\s+打开工作区/ }).click();
  await expectText(page, "数据健康诊断", "data workspace");
  await expectText(page, "维护证据矩阵");
  await expectText(page, "Data Maintenance JSON");
  await expectText(page, "手动长刷新");
  await expectText(page, "后台长刷新");
  await expectText(page, "刷新运行锁");
  await expectText(page, "队列去重");
  await expectText(page, "重试最近失败");
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
  await expectText(page, "执行生命周期");
  await expectText(page, "连接器健康");
  await expectText(page, "私有接口锁");
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
  await expectText(page, "AI4Trade 只读信号源");
  await expectText(page, "跟单、发布和挑战交易全部被本地策略锁定", "AI4Trade local trading locks");
  await expectText(page, "对齐自检", "AI4Trade alignment check");
  await expectText(page, "OKX联动", "AI4Trade OKX linkage card");
  await expectText(page, "只进入人工评估和 dry-run 注释", "AI4Trade read-only annotation policy");
  await expectText(page, "Readiness快照历史");
  await expectText(page, "AI4Trade Read-only JSON");
  await expectText(page, "AI4Trade历史");
  await expectText(page, "实盘动作队列");
  await expectText(page, "自动化自检历史");
  await expectText(page, "自动化心跳历史");
  await expectText(page, "提交确认控制台");
  await expectText(page, "Connector Preview JSON");
  await expectText(page, "签名预览");
  await expectText(page, "私有自检");
  await expectText(page, "只读回执");
  await expectText(page, "保存回执");
  await expectText(page, "OKX诊断历史");
  await expectText(page, "单笔名义上限");
  await expectText(page, "Canary试运行");
  await expectText(page, "Canary小额试运行预览");
  await expectText(page, "确认短语锁测试");
  await expectText(page, "Canary锁测试");
  await expectText(page, "刷新执行账本");
  await expectText(page, "账本详情");
  await expectText(page, "订单生命周期证据");
  await expectText(page, "生命周期处置");
  await expectText(page, "ADAPTER PREVIEW");
  await expectText(page, "记录查询回执");
  await expectText(page, "查询OKX状态");
  await expectText(page, "记录撤单回执");
  await expectText(page, "提交真实撤单");
  await expectText(page, "记录成交回执");
  await expectText(page, "Payload / Gate JSON");
  const detailButtons = await page.getByRole("button", { name: "详情" }).count();
  if (detailButtons > 0) {
    await page.getByRole("button", { name: "详情" }).first().click();
    await expectText(page, "Final Gate 检查");
  }
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  if (errors.length) {
    throw new Error(`Browser errors:\n${errors.join("\n")}`);
  }
  await browser.close();
  console.log(`OK UI smoke passed: ${baseUrl}`);
  console.log(`UI screenshot: ${screenshotPath}`);
}

main().catch(async (error) => {
  console.error(error.message);
  process.exit(1);
});
