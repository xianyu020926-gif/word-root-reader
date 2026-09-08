# 安全说明

不要把 DeepSeek、Gemini、OpenAI 或其他服务的真实 API Key 写进源码、截图、Issue、Actions 日志或提交历史。

网页端默认只把用户临时填写的 Key 保存在当前标签页会话中，并经同源后端转发；桌面版和 Android 版直接向模型服务请求。私有云端可以通过 `DEEPSEEK_API_KEY` 托管 Key，但部署必须先有可靠的访问控制。公开部署不得启用共用 Key，否则访问者可能消耗账户余额。

如果 Key 曾经进入 GitHub，即使后来删除文件，也应立刻在模型服务后台撤销并重新生成。
