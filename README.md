# 区域操作 Agent

在 Mewu 原有截图界面框选区域，直接在对话条输入任务。插件通过模型观察当前区域、执行一个动作，再用新截图决定下一步。

当前原生输入适配器仅支持 Windows；macOS 和 Linux 仍可截图问答。需启用插件并配置支持图像和工具调用的模型。Esc 或停止会撤销后续动作。

## 安装与开发

在 Mewu 的插件市场搜索 **区域操作 Agent**，核对本项目源码后安装。已有版本的发行资产保留在[社区市场发行页](https://github.com/abnste/mewu-plugins/releases)，不变更用户现有的更新来源。

本仓库根目录的 mewu-plugin.json 与 index.mjs 是可独立打包的完整插件源码，无须修改 Mewu 核心。[Mewu API SDK](https://github.com/abnste/mewu_ai/tree/master/packages/sdk) · [打包与 GitHub 投稿](https://github.com/abnste/mewu_ai/tree/master/tools/extension-market)

## 实际效果

以下来自 Windows 原生运行的 0.1.2：普通对话条发起任务，目标接收两次实际鼠标操作，第二个按钮的位置由第一次操作后新生成的截图确定。第一张仅裁出对话界面，未重绘或合成内容。

![普通对话条任务完成](screenshots/conversation-windows.png)

![原生目标实际达到计数 2](screenshots/target-completed-windows.jpg)

## 许可

MPL-2.0，与 Mewu 一致。
