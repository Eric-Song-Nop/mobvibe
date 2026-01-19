# ASCII 文案替换（实现前）

## 背景

聊天空态文案 `chat.startConversation` 当前为普通提示语，希望替换为更具品牌感的 ASCII 文字，用于展示 Mobvibe 标识并引导用户开始对话。该文案需要保持静态、易读、适配移动端展示。

## 目标

- 用大写 ASCII 文字展示 `MOBVIBE`。
- 使用阴影字符营造层次感，保持轻量、静态。
- 不引入额外动画或复杂渲染逻辑。

## 设计约束

- 使用纯文本（ASCII + 轻量阴影字符）。
- 不引入多帧动画与动态效果。
- 保持宽度在聊天区域可读范围内。

## 替换内容

```
██   ██  █████  ██████  ██   ██  ███████  ██████  ███████
███ ███  ██   ██  ██   ██  ██   ██   ███   ██   ██  ██     
██ █ ██  ██   ██  ██████  ██   ██   ███   ██████  ██████ 
██   ██  ██   ██  ██   ██   ██ ██    ███   ██   ██  ██     
██   ██   █████   ██████    ███   ███████  ██████  ███████
 ░░░░░░   ░░░░░   ░░░░░░     ░░     ░░░░░░   ░░░░░   ░░░░  
```

## 实现后记录

- `chat.startConversation` 替换为静态 ASCII 文案，并在空态文本添加 `font-mono` 与 `whitespace-pre`。

## 影响范围

- `apps/web/src/i18n/locales/zh/translation.json` 与 `apps/web/src/i18n/locales/en/translation.json` 的 `chat.startConversation`。
- `apps/web/src/components/app/ChatMessageList.tsx` 空态文本使用等宽字体与保留换行。
