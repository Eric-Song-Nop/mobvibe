export type LegalDocumentId = "privacy" | "terms" | "refund";
export type LegalLocale = "en" | "zh";

export type LegalSection = {
	id: string;
	title: string;
	paragraphs: string[];
	bullets?: string[];
};

export type LegalLocaleContent = {
	title: string;
	summary: string;
	sections: LegalSection[];
};

export type LegalDocument = {
	id: LegalDocumentId;
	slug: `/${LegalDocumentId}`;
	updatedAt: string;
	effectiveDate: Record<LegalLocale, string>;
	operatorName: string;
	contactEmail: string;
	locales: Record<LegalLocale, LegalLocaleContent>;
};

const operatorName = "Yifan Song";
const contactEmail = "Ericoolen@yeah.net";
const updatedAt = "2026-03-09";
const effectiveDate = {
	en: "March 9, 2026",
	zh: "2026年3月9日",
} as const;

export const legalDocuments: LegalDocument[] = [
	{
		id: "privacy",
		slug: "/privacy",
		updatedAt,
		effectiveDate,
		operatorName,
		contactEmail,
		locales: {
			en: {
				title: "Privacy Policy",
				summary:
					"This Privacy Policy explains how Mobvibe collects, uses, stores, and shares information when you use the Mobvibe website, web app, desktop app, mobile app, CLI, and related services.",
				sections: [
					{
						id: "scope",
						title: "1. Scope",
						paragraphs: [
							"This Privacy Policy applies to Mobvibe and related services available through mobvibe.net, app.mobvibe.net, the Mobvibe CLI, and related desktop or mobile applications.",
							"Mobvibe is operated by Yifan Song. If you have privacy questions or requests, you can contact us at Ericoolen@yeah.net.",
						],
					},
					{
						id: "information-we-collect",
						title: "2. Information We Collect",
						paragraphs: [
							"We collect information you provide directly and limited account, device, and subscription-related information needed to operate Mobvibe securely.",
						],
						bullets: [
							"Account information, such as your email address, display name, password-related or verification data handled by our authentication system, and support communications.",
							"Authentication and security records, such as login session records, IP address, user agent, and verification records used to secure account access.",
							"Registered machine and device information, such as machine ID, machine name, hostname, platform, device public key, device name, and last-seen timestamps needed to connect and authorize your devices.",
							"Browser notification subscription data, such as push endpoint, subscription keys, locale, and user agent, if you enable web push notifications.",
							"If you purchase a subscription, payment and billing information is processed through Paddle, such as order IDs, plan names, billing country, tax information, subscription status, renewal dates, and limited transaction metadata. Mobvibe does not store your full payment card number.",
							"The gateway database does not persist chat content, session transcripts, session titles, or workspace paths as part of its current server-side schema.",
						],
					},
					{
						id: "how-we-use-information",
						title: "3. How We Use Information",
						paragraphs: [
							"We use collected information to operate, secure, improve, and support Mobvibe.",
						],
						bullets: [
							"Create and manage accounts, authenticate users, and maintain account login sessions.",
							"Register and authorize your machines and devices so the service can connect them securely.",
							"Deliver browser push notifications if you choose to enable them.",
							"Process payments, manage subscriptions, send receipts, handle refunds, and respond to billing issues.",
							"Detect abuse, investigate incidents, debug errors, maintain service reliability, and enforce our Terms of Service.",
							"Communicate with you about account activity, policy updates, service changes, security notices, and support requests.",
						],
					},
					{
						id: "sharing",
						title: "4. How We Share Information",
						paragraphs: [
							"We do not sell your personal information. We only share information when necessary to operate the service, comply with law, or protect rights and safety.",
						],
						bullets: [
							"With Paddle and its payment partners to provide checkout, recurring billing, tax handling, invoicing, subscription management, and fraud prevention.",
							"With infrastructure, hosting, database, email, analytics, or notification providers that help us operate Mobvibe under appropriate confidentiality and processing obligations.",
							"With legal authorities or other parties when required by law, court order, or to investigate fraud, abuse, security incidents, or violations of our terms.",
							"In connection with a merger, financing, acquisition, sale of assets, or similar transaction, subject to appropriate confidentiality safeguards.",
						],
					},
					{
						id: "retention-security",
						title: "5. Data Retention and Security",
						paragraphs: [
							"We retain personal information for as long as reasonably necessary to provide the service, comply with legal obligations, resolve disputes, and enforce agreements.",
							"We use reasonable technical and organizational safeguards to protect information. No service can guarantee absolute security, and you are responsible for protecting your devices, credentials, and any local secrets you use with Mobvibe.",
						],
					},
					{
						id: "choices-rights",
						title: "6. Your Choices and Rights",
						paragraphs: [
							"Depending on your location, you may have rights to access, correct, delete, or export certain personal information, or to object to or restrict some processing.",
							"You may also cancel a paid subscription before the next renewal date to stop future billing. To make a privacy request or request account deletion, contact Ericoolen@yeah.net from the email associated with your account.",
						],
					},
					{
						id: "children-transfers",
						title: "7. Children and International Use",
						paragraphs: [
							"Mobvibe is not directed to children, and you should not use the service if you are not legally able to enter into this agreement where you live.",
							"Mobvibe may be accessed internationally, and your information may be processed in countries other than your own. By using the service, you understand that cross-border processing may occur subject to applicable law.",
						],
					},
					{
						id: "updates-contact",
						title: "8. Updates and Contact",
						paragraphs: [
							"We may update this Privacy Policy from time to time. The updated version will be posted on this page with a new effective date.",
							"If you have questions about this Privacy Policy or want to exercise a privacy right, email Ericoolen@yeah.net.",
						],
					},
				],
			},
			zh: {
				title: "隐私政策",
				summary:
					"本隐私政策说明，当您使用 Mobvibe 网站、Web 应用、桌面应用、移动应用、CLI 及相关服务时，Mobvibe 如何收集、使用、存储和共享信息。",
				sections: [
					{
						id: "scope",
						title: "1. 适用范围",
						paragraphs: [
							"本隐私政策适用于通过 mobvibe.net、app.mobvibe.net、Mobvibe CLI 以及相关桌面端或移动端应用提供的 Mobvibe 服务。",
							"Mobvibe 由 Yifan Song 运营。如您对隐私问题或相关请求有疑问，可发送邮件至 Ericoolen@yeah.net 联系我们。",
						],
					},
					{
						id: "information-we-collect",
						title: "2. 我们收集的信息",
						paragraphs: [
							"我们会收集您直接提供的信息，以及为安全运行 Mobvibe 所必需的有限账户、设备和订阅相关信息。",
						],
						bullets: [
							"账户信息，例如您的邮箱地址、显示名称、由认证系统处理的密码相关或验证数据，以及与客服沟通的内容。",
							"认证与安全记录，例如登录会话记录、IP 地址、User-Agent，以及用于保护账户访问的验证记录。",
							"已注册机器和设备的信息，例如机器 ID、机器名称、主机名、平台、设备公钥、设备名称，以及用于连接和授权设备的最后在线时间。",
							"当您启用浏览器推送通知时，我们会保存推送 endpoint、订阅密钥、语言设置和 User-Agent 等 Web Push 订阅数据。",
							"如果您购买订阅，支付和账单信息会通过 Paddle 处理，例如订单号、套餐名称、账单国家、税务信息、订阅状态、续费日期以及有限的交易元数据。Mobvibe 不会保存您的完整银行卡号。",
							"按照当前服务器端 schema，网关数据库不会持久化保存聊天内容、会话转录、会话标题或工作区路径。",
						],
					},
					{
						id: "how-we-use-information",
						title: "3. 我们如何使用信息",
						paragraphs: [
							"我们使用所收集的信息来运营、保护、改进并支持 Mobvibe。",
						],
						bullets: [
							"创建和管理账户、验证用户身份，并维护账户登录会话。",
							"注册并授权您的机器和设备，使服务能够安全地连接它们。",
							"在您选择启用时，向您的浏览器发送推送通知。",
							"处理付款、管理订阅、发送收据、处理退款，并响应账单问题。",
							"检测滥用行为、调查事故、调试错误、维护服务稳定性，并执行我们的服务条款。",
							"就账户活动、政策更新、服务变更、安全通知和客服请求与您沟通。",
						],
					},
					{
						id: "sharing",
						title: "4. 我们如何共享信息",
						paragraphs: [
							"我们不会出售您的个人信息。只有在运营服务、履行法律义务或保护权利与安全所必需时，我们才会共享信息。",
						],
						bullets: [
							"与 Paddle 及其支付合作方共享，以提供结账、循环扣费、税务处理、开票、订阅管理和反欺诈服务。",
							"与帮助我们运营 Mobvibe 的基础设施、托管、数据库、邮件、分析或通知服务提供方共享，并要求其承担适当的保密与数据处理义务。",
							"在法律、法院命令要求，或为调查欺诈、滥用、安全事件或违反条款行为时，与执法或其他合法机构共享。",
							"在合并、融资、收购、资产出售或类似交易中，在适当保密保障下进行共享。",
						],
					},
					{
						id: "retention-security",
						title: "5. 数据保留与安全",
						paragraphs: [
							"我们会在为提供服务、遵守法律义务、解决争议和执行协议所合理必要的期限内保留个人信息。",
							"我们采取合理的技术和组织措施保护信息安全。但任何服务都无法保证绝对安全，您也有责任保护自己的设备、账户凭证以及在 Mobvibe 中使用的本地密钥。",
						],
					},
					{
						id: "choices-rights",
						title: "6. 您的选择与权利",
						paragraphs: [
							"根据您所在地区的法律，您可能享有访问、更正、删除、导出个人信息，或对某些处理提出异议或限制处理的权利。",
							"您也可以在下一次续费前取消付费订阅，以停止未来扣费。如需提出隐私请求或删除账户，请使用与账户关联的邮箱联系 Ericoolen@yeah.net。",
						],
					},
					{
						id: "children-transfers",
						title: "7. 未成年人和国际使用",
						paragraphs: [
							"Mobvibe 不面向儿童提供服务。如果您在所在地法律下无权订立本协议，请不要使用本服务。",
							"Mobvibe 可能在全球范围内被访问，您的信息也可能在您所在国家或地区之外被处理。使用本服务即表示您理解，在适用法律允许范围内可能发生跨境处理。",
						],
					},
					{
						id: "updates-contact",
						title: "8. 更新与联系",
						paragraphs: [
							"我们可能会不时更新本隐私政策。更新后的版本会发布在本页面，并标注新的生效日期。",
							"如果您对本隐私政策有任何问题，或希望行使隐私权利，请发送邮件至 Ericoolen@yeah.net。",
						],
					},
				],
			},
		},
	},
	{
		id: "terms",
		slug: "/terms",
		updatedAt,
		effectiveDate,
		operatorName,
		contactEmail,
		locales: {
			en: {
				title: "Terms of Service",
				summary:
					"These Terms of Service govern your access to and use of Mobvibe, including free features, paid subscriptions for multi-machine functionality, and related websites, applications, and services.",
				sections: [
					{
						id: "acceptance",
						title: "1. Acceptance of Terms",
						paragraphs: [
							"By accessing or using Mobvibe, you agree to these Terms of Service and any policies referenced in them, including the Privacy Policy and Refund Policy.",
							"If you use Mobvibe on behalf of an organization, you represent that you have authority to bind that organization to these terms.",
						],
					},
					{
						id: "service-overview",
						title: "2. Service Overview",
						paragraphs: [
							"Mobvibe provides remote management tools for AI coding agents across web, desktop, mobile, and CLI surfaces.",
							"Some Mobvibe features may be available for free, but multi-machine functionality and certain related capabilities require an active paid subscription. The exact features, limits, and pricing are the ones shown to you at checkout or in the applicable product interface.",
						],
					},
					{
						id: "accounts-security",
						title: "3. Accounts and Security",
						paragraphs: [
							"You must provide accurate account information and keep your login credentials, local secrets, and devices secure.",
							"You are responsible for activity that occurs under your account, including activity from connected machines and devices that you authorize.",
						],
					},
					{
						id: "billing-subscriptions",
						title: "4. Billing, Paddle, and Auto-Renewal",
						paragraphs: [
							"Paid subscriptions for Mobvibe are billed through Paddle. Paddle may handle checkout, recurring billing, invoicing, tax collection, and related subscription administration.",
							"Unless otherwise stated at checkout, subscriptions renew automatically at the end of each billing period until canceled. To avoid the next renewal charge, you must cancel before the renewal date using a method made available through Paddle, your receipt email, or Mobvibe.",
							"Prices, taxes, billing intervals, and included features may vary by region or plan and will be presented during checkout.",
						],
					},
					{
						id: "refunds",
						title: "5. Refunds",
						paragraphs: [
							"Refunds are governed by the Mobvibe Refund Policy. In summary, the first subscription purchase may be eligible for a refund within 14 days of the initial charge, while renewals are generally non-refundable unless required by law or approved for duplicate billing or service failure.",
						],
					},
					{
						id: "acceptable-use",
						title: "6. Acceptable Use",
						paragraphs: [
							"You agree not to misuse Mobvibe, interfere with the service, or use it in a way that violates law or third-party rights.",
						],
						bullets: [
							"Do not attempt to bypass subscription checks, plan limits, access controls, or security measures.",
							"Do not use the service to distribute malware, abuse third-party systems, perform unauthorized access, or engage in illegal, fraudulent, or harmful conduct.",
							"Do not interfere with the stability, availability, or integrity of Mobvibe or other users' access to the service.",
							"Do not use Mobvibe in violation of any rules, licenses, or terms that apply to the AI agents, code, repositories, or systems you connect.",
						],
					},
					{
						id: "content-ip",
						title: "7. Your Content and Feedback",
						paragraphs: [
							"You retain ownership of your code, prompts, files, machine data, and other content that you submit to Mobvibe.",
							"You grant Mobvibe a limited license to host, transmit, process, store, and display that content only as needed to operate, secure, and improve the service.",
							"If you provide feedback, suggestions, or feature requests, you allow Mobvibe to use them without restriction or compensation.",
						],
					},
					{
						id: "changes-termination",
						title: "8. Changes, Suspension, and Termination",
						paragraphs: [
							"We may update, modify, suspend, or discontinue features at any time, including free or paid functionality, if reasonably necessary for product, legal, security, or operational reasons.",
							"We may suspend or terminate access if you violate these terms, create risk for the service or others, fail to pay required fees, or if continued operation is no longer practical.",
							"You may stop using the service at any time. Canceling a subscription stops future renewals but does not automatically erase account or usage data that we must retain for legal, security, or operational reasons.",
						],
					},
					{
						id: "disclaimers-liability",
						title: "9. Disclaimers and Limitation of Liability",
						paragraphs: [
							'Mobvibe is provided on an "as is" and "as available" basis without warranties of any kind to the extent permitted by law. We do not guarantee uninterrupted availability, error-free operation, or that the service will meet every specific requirement.',
							"To the maximum extent permitted by law, Mobvibe and Yifan Song will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of profits, revenue, data, goodwill, or business opportunities arising from or related to your use of the service.",
						],
					},
					{
						id: "contact-updates",
						title: "10. Contact and Updates",
						paragraphs: [
							"We may update these Terms of Service from time to time. If we make material changes, we will post the updated terms with a new effective date.",
							"If you have questions about these terms, contact Ericoolen@yeah.net.",
						],
					},
				],
			},
			zh: {
				title: "服务条款",
				summary:
					"本服务条款适用于您对 Mobvibe 的访问和使用，包括免费功能、用于多机器能力的付费订阅，以及相关网站、应用和服务。",
				sections: [
					{
						id: "acceptance",
						title: "1. 条款接受",
						paragraphs: [
							"当您访问或使用 Mobvibe，即表示您同意受本服务条款及其引用政策的约束，包括隐私政策和退款政策。",
							"如果您代表某个组织使用 Mobvibe，则表示您有权使该组织受本条款约束。",
						],
					},
					{
						id: "service-overview",
						title: "2. 服务说明",
						paragraphs: [
							"Mobvibe 提供面向 AI 编程 Agent 的远程管理工具，覆盖 Web、桌面端、移动端和 CLI 等使用场景。",
							"Mobvibe 的部分功能可能免费提供，但多机器功能以及部分相关高级能力需要有效的付费订阅。具体可用功能、限制和价格，以结账页面或相应产品界面向您展示的内容为准。",
						],
					},
					{
						id: "accounts-security",
						title: "3. 账户与安全",
						paragraphs: [
							"您必须提供准确的账户信息，并妥善保管您的登录凭证、本地密钥和设备安全。",
							"对于在您账户下发生的活动，包括您授权连接的机器和设备产生的活动，您应承担责任。",
						],
					},
					{
						id: "billing-subscriptions",
						title: "4. 计费、Paddle 与自动续费",
						paragraphs: [
							"Mobvibe 的付费订阅通过 Paddle 计费。Paddle 可能会处理结账、循环扣费、开票、税费代收及相关订阅管理事务。",
							"除非结账页面另有说明，订阅将在每个计费周期结束时自动续费，直至您取消。若要避免下一次续费扣款，您必须在续费日期前通过 Paddle、收据邮件中提供的方式或 Mobvibe 提供的取消方式完成取消。",
							"价格、税费、计费周期和包含功能可能因地区或套餐而异，并会在结账时向您展示。",
						],
					},
					{
						id: "refunds",
						title: "5. 退款",
						paragraphs: [
							"退款事宜受 Mobvibe 退款政策约束。简而言之，首次订阅付款可在首次扣款后 14 天内申请退款；续费通常不予退款，除非法律另有要求，或经核准属于重复扣费或服务故障情形。",
						],
					},
					{
						id: "acceptable-use",
						title: "6. 可接受使用",
						paragraphs: [
							"您同意不会滥用 Mobvibe、干扰服务运行，或以违反法律或第三方权利的方式使用本服务。",
						],
						bullets: [
							"不得尝试绕过订阅校验、套餐限制、访问控制或安全措施。",
							"不得利用本服务传播恶意软件、滥用第三方系统、实施未授权访问，或从事违法、欺诈或有害行为。",
							"不得干扰 Mobvibe 的稳定性、可用性、完整性，或影响其他用户对服务的正常使用。",
							"不得以违反所连接 AI Agent、代码、仓库或系统适用规则、许可或条款的方式使用 Mobvibe。",
						],
					},
					{
						id: "content-ip",
						title: "7. 您的内容与反馈",
						paragraphs: [
							"您对提交到 Mobvibe 的代码、提示词、文件、机器数据和其他内容保留所有权。",
							"您授予 Mobvibe 一项有限许可，仅在运营、保护和改进服务所需的范围内，对这些内容进行托管、传输、处理、存储和展示。",
							"如果您提供反馈、建议或功能需求，即表示您允许 Mobvibe 无限制且无需补偿地使用这些内容。",
						],
					},
					{
						id: "changes-termination",
						title: "8. 变更、中止与终止",
						paragraphs: [
							"基于产品、法律、安全或运营需要，我们可以随时更新、修改、暂停或停止部分功能，包括免费或付费功能。",
							"如果您违反本条款、给服务或他人带来风险、未支付应付费用，或继续提供服务已不再可行，我们可以暂停或终止您的访问权限。",
							"您可以随时停止使用本服务。取消订阅会阻止未来续费，但不会自动删除我们因法律、安全或运营原因必须保留的账户或使用数据。",
						],
					},
					{
						id: "disclaimers-liability",
						title: "9. 免责声明与责任限制",
						paragraphs: [
							"在法律允许的最大范围内，Mobvibe 按“现状”和“可用”基础提供，不作任何形式的保证。我们不保证服务持续不中断、无错误，也不保证其一定满足您的所有特定需求。",
							"在法律允许的最大范围内，Mobvibe 及 Yifan Song 不对因您使用服务而产生或与之相关的任何间接性、附带性、特殊性、后果性、惩罚性损害，或利润、收入、数据、商誉、商业机会损失承担责任。",
						],
					},
					{
						id: "contact-updates",
						title: "10. 更新与联系",
						paragraphs: [
							"我们可能会不时更新本服务条款。如有重大变更，我们会发布更新后的条款并标注新的生效日期。",
							"如果您对本条款有任何疑问，请联系 Ericoolen@yeah.net。",
						],
					},
				],
			},
		},
	},
	{
		id: "refund",
		slug: "/refund",
		updatedAt,
		effectiveDate,
		operatorName,
		contactEmail,
		locales: {
			en: {
				title: "Refund Policy",
				summary:
					"This Refund Policy explains when Mobvibe subscription charges may be refunded and how refund requests should be submitted for subscriptions billed through Paddle.",
				sections: [
					{
						id: "scope",
						title: "1. Scope",
						paragraphs: [
							"This Refund Policy applies to paid Mobvibe subscriptions billed through Paddle for multi-machine functionality and any related paid features that explicitly reference this policy.",
							"This policy does not limit any non-waivable consumer rights you may have under applicable law.",
						],
					},
					{
						id: "first-purchase-window",
						title: "2. First Subscription Purchase: 14-Day Refund Window",
						paragraphs: [
							"You may request a refund for your first Mobvibe subscription purchase within 14 calendar days of the initial successful charge.",
							"If approved, the refund will generally be returned to the original payment method used for the transaction.",
						],
					},
					{
						id: "non-refundable-renewals",
						title: "3. Renewals and Standard Non-Refundable Cases",
						paragraphs: [
							"Except where required by law, renewal charges are generally non-refundable.",
							"Refunds are also usually not available for partial billing periods, unused time after renewal, or changes of mind made after the 14-day initial purchase window has passed.",
						],
					},
					{
						id: "special-cases",
						title: "4. Duplicate Charges and Service Failure",
						paragraphs: [
							"We may approve a refund outside the standard window if there was a duplicate charge, an obvious billing error, or a verified technical issue that materially prevented the paid multi-machine subscription feature from working and we could not provide a reasonable fix.",
						],
					},
					{
						id: "cancellation-vs-refund",
						title: "5. Cancellation Is Not the Same as a Refund",
						paragraphs: [
							"Canceling your subscription prevents future renewals, but it does not automatically refund charges that have already been processed.",
							"To avoid your next renewal charge, you must cancel before the renewal date using the method provided through Paddle, your receipt email, or Mobvibe.",
						],
					},
					{
						id: "request-process",
						title: "6. How to Request a Refund",
						paragraphs: [
							"To request a refund, email Ericoolen@yeah.net and include enough information for us to locate the transaction.",
						],
						bullets: [
							"The email address associated with your Mobvibe account.",
							"Your Paddle receipt, order ID, or subscription ID if available.",
							"A short explanation of the refund reason.",
						],
					},
					{
						id: "timing",
						title: "7. Review and Processing Time",
						paragraphs: [
							"We aim to review refund requests within 5 business days. If a refund is approved, the time it takes to appear on your original payment method depends on Paddle, your payment provider, and your bank or card network.",
						],
					},
					{
						id: "updates-contact",
						title: "8. Updates and Contact",
						paragraphs: [
							"We may update this Refund Policy from time to time. The latest version will always be posted on this page with the current effective date.",
							"If you have questions about this Refund Policy, contact Ericoolen@yeah.net.",
						],
					},
				],
			},
			zh: {
				title: "退款政策",
				summary:
					"本退款政策说明，针对通过 Paddle 计费的 Mobvibe 订阅，在哪些情况下可以退款，以及应如何提交退款申请。",
				sections: [
					{
						id: "scope",
						title: "1. 适用范围",
						paragraphs: [
							"本退款政策适用于通过 Paddle 计费的 Mobvibe 付费订阅，这些订阅主要用于多机器功能以及明确引用本政策的相关付费能力。",
							"本政策不限制适用法律下您享有的任何不可放弃的消费者权利。",
						],
					},
					{
						id: "first-purchase-window",
						title: "2. 首次订阅付款：14 天退款窗口",
						paragraphs: [
							"对于您的首次 Mobvibe 订阅购买，您可以在首次成功扣款后的 14 个自然日内申请退款。",
							"若退款获批，通常会原路退回至您支付该笔交易时使用的付款方式。",
						],
					},
					{
						id: "non-refundable-renewals",
						title: "3. 续费及通常不退款情形",
						paragraphs: [
							"除非法律另有要求，续费款项通常不予退款。",
							"对于部分计费周期、续费后的未使用时长，或超过首次购买 14 天后因改变主意而提出的申请，通常也不提供退款。",
						],
					},
					{
						id: "special-cases",
						title: "4. 重复扣费与服务故障",
						paragraphs: [
							"如果发生重复扣费、明显的账单错误，或经核实存在重大技术问题导致付费的多机器订阅功能无法正常使用，且我们无法提供合理修复方案，我们可以在标准退款窗口之外批准退款。",
						],
					},
					{
						id: "cancellation-vs-refund",
						title: "5. 取消订阅不等于自动退款",
						paragraphs: [
							"取消订阅会阻止未来续费，但不会自动退还已经成功处理的款项。",
							"若要避免下一次续费扣款，您必须在续费日期前通过 Paddle、收据邮件中提供的方式或 Mobvibe 提供的取消方式完成取消。",
						],
					},
					{
						id: "request-process",
						title: "6. 如何申请退款",
						paragraphs: [
							"如需申请退款，请发送邮件至 Ericoolen@yeah.net，并提供足以让我们定位交易的信息。",
						],
						bullets: [
							"与您的 Mobvibe 账户关联的邮箱地址。",
							"您的 Paddle 收据、订单号或订阅 ID（如有）。",
							"简要说明退款原因。",
						],
					},
					{
						id: "timing",
						title: "7. 审核与处理时间",
						paragraphs: [
							"我们会尽量在 5 个工作日内审核退款请求。若退款获批，款项何时回到原支付方式，取决于 Paddle、支付服务提供方以及您的银行或卡组织。",
						],
					},
					{
						id: "updates-contact",
						title: "8. 更新与联系",
						paragraphs: [
							"我们可能会不时更新本退款政策。最新版本将始终发布在本页面，并标注当前生效日期。",
							"如果您对本退款政策有任何疑问，请联系 Ericoolen@yeah.net。",
						],
					},
				],
			},
		},
	},
];

export const legalDocumentIds = legalDocuments.map(
	(document) => document.id,
) as LegalDocumentId[];

export const legalDocumentsById = Object.fromEntries(
	legalDocuments.map((document) => [document.id, document]),
) as Record<LegalDocumentId, LegalDocument>;

const normalizePath = (pathname: string) => {
	if (!pathname || pathname === "/") {
		return "/";
	}

	return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
};

export const getLegalDocument = (id: LegalDocumentId) => legalDocumentsById[id];

export const getLegalDocumentByPath = (pathname: string) => {
	const normalizedPath = normalizePath(pathname);

	return (
		legalDocuments.find((document) => document.slug === normalizedPath) ?? null
	);
};
