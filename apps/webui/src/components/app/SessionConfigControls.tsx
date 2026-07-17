import { Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@mobvibe/ui/button";
import { Checkbox } from "@mobvibe/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@mobvibe/ui/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@mobvibe/ui/select";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { SessionConfigOption } from "@/lib/acp";
import { cn } from "@/lib/utils";

type SelectConfigOption = Extract<SessionConfigOption, { type: "select" }>;
type BooleanConfigOption = Extract<SessionConfigOption, { type: "boolean" }>;

export type SessionConfigValue = string | boolean;

type SessionConfigControlsProps = {
	options: SessionConfigOption[];
	disabled?: boolean;
	pendingConfigId?: string;
	onChange: (configId: string, value: SessionConfigValue) => void;
};

type ConfigSelectProps = {
	compact?: boolean;
	descriptionId?: string;
	disabled?: boolean;
	option: SelectConfigOption;
	onChange: (value: string) => void;
};

type ConfigBooleanProps = {
	categoryLabel: string;
	disabled?: boolean;
	option: BooleanConfigOption;
	onChange: (value: boolean) => void;
};

type ConfigSelectRowProps = {
	categoryLabel: string;
	disabled?: boolean;
	option: SelectConfigOption;
	onChange: (value: string) => void;
};

const categoryTranslationKeys: Record<string, string> = {
	mode: "chat.sessionConfigCategoryMode",
	model: "chat.sessionConfigCategoryModel",
	model_config: "chat.sessionConfigCategoryModelConfig",
	thought_level: "chat.sessionConfigCategoryThoughtLevel",
};

const encodeSelectValue = (value: string) => `acp:${value}`;
const decodeSelectValue = (value: string) => value.slice("acp:".length);

function ConfigSelect({
	compact = false,
	descriptionId,
	disabled,
	option,
	onChange,
}: ConfigSelectProps) {
	const currentOption = option.options
		.flatMap((item) => ("options" in item ? item.options : [item]))
		.find((item) => item.value === option.currentValue);
	return (
		<Select
			value={encodeSelectValue(option.currentValue)}
			onValueChange={(value) => onChange(decodeSelectValue(value))}
			disabled={disabled}
		>
			<SelectTrigger
				size="sm"
				aria-label={option.name}
				aria-describedby={descriptionId}
				title={option.description ?? undefined}
				className={cn(
					"min-w-32 max-w-52",
					compact &&
						"h-auto w-auto max-w-32 truncate border-0 bg-transparent px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus:ring-0 focus-visible:ring-1 focus-visible:ring-ring/50",
				)}
			>
				<SelectValue>{currentOption?.name ?? option.currentValue}</SelectValue>
			</SelectTrigger>
			<SelectContent align={compact ? "start" : "end"}>
				{option.options.map((item) =>
					"options" in item ? (
						<SelectGroup key={item.group}>
							<SelectLabel>{item.name}</SelectLabel>
							{item.options.map((groupedOption) => (
								<SelectItem
									key={`${item.group}:${groupedOption.value}`}
									value={encodeSelectValue(groupedOption.value)}
								>
									<span className="flex min-w-0 flex-col">
										<span className="truncate">{groupedOption.name}</span>
										{groupedOption.description ? (
											<span className="max-w-64 text-pretty text-muted-foreground">
												{groupedOption.description}
											</span>
										) : null}
									</span>
								</SelectItem>
							))}
						</SelectGroup>
					) : (
						<SelectItem key={item.value} value={encodeSelectValue(item.value)}>
							<span className="flex min-w-0 flex-col">
								<span className="truncate">{item.name}</span>
								{item.description ? (
									<span className="max-w-64 text-pretty text-muted-foreground">
										{item.description}
									</span>
								) : null}
							</span>
						</SelectItem>
					),
				)}
			</SelectContent>
		</Select>
	);
}

function ConfigBoolean({
	categoryLabel,
	disabled,
	option,
	onChange,
}: ConfigBooleanProps) {
	const checkboxId = useId();
	const descriptionId = `${checkboxId}-description`;
	return (
		<div className="flex min-w-0 items-start justify-between gap-3">
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-1.5">
					<label htmlFor={checkboxId} className="truncate text-xs font-medium">
						{option.name}
					</label>
					<span className="shrink-0 text-[10px] text-muted-foreground">
						{categoryLabel}
					</span>
				</div>
				{option.description ? (
					<p
						id={descriptionId}
						className="mt-0.5 break-words text-pretty text-xs text-muted-foreground"
					>
						{option.description}
					</p>
				) : null}
			</div>
			<Checkbox
				id={checkboxId}
				checked={option.currentValue}
				disabled={disabled}
				aria-describedby={option.description ? descriptionId : undefined}
				onCheckedChange={(checked) => {
					if (typeof checked === "boolean") {
						onChange(checked);
					}
				}}
			/>
		</div>
	);
}

function ConfigSelectRow({
	categoryLabel,
	disabled,
	option,
	onChange,
}: ConfigSelectRowProps) {
	const descriptionId = useId();
	return (
		<div className="min-w-0 space-y-1.5">
			<div className="flex min-w-0 items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-1.5">
						<span className="truncate text-xs font-medium">{option.name}</span>
						<span className="shrink-0 text-[10px] text-muted-foreground">
							{categoryLabel}
						</span>
					</div>
					{option.description ? (
						<p
							id={descriptionId}
							className="mt-0.5 break-words text-pretty text-xs text-muted-foreground"
						>
							{option.description}
						</p>
					) : null}
				</div>
				<ConfigSelect
					option={option}
					descriptionId={option.description ? descriptionId : undefined}
					disabled={disabled}
					onChange={onChange}
				/>
			</div>
		</div>
	);
}

export function SessionConfigControls({
	options,
	disabled,
	pendingConfigId,
	onChange,
}: SessionConfigControlsProps) {
	const { t } = useTranslation();
	const firstOption = options[0];
	const primaryModel: SelectConfigOption | undefined =
		firstOption?.type === "select" && firstOption.category === "model"
			? firstOption
			: undefined;
	const remainingOptions = primaryModel ? options.slice(1) : options;

	if (options.length === 0) {
		return null;
	}

	return (
		<span
			className="contents"
			aria-busy={pendingConfigId !== undefined ? true : undefined}
		>
			{primaryModel ? (
				<ConfigSelect
					compact
					option={primaryModel}
					disabled={disabled || pendingConfigId !== undefined}
					onChange={(value) => onChange(primaryModel.id, value)}
				/>
			) : null}
			{remainingOptions.length > 0 ? (
				<Popover>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							disabled={disabled}
							aria-label={t("chat.sessionConfig")}
							title={t("chat.sessionConfig")}
						>
							<HugeiconsIcon
								icon={Settings02Icon}
								strokeWidth={2}
								aria-hidden="true"
							/>
						</Button>
					</PopoverTrigger>
					<PopoverContent
						align="start"
						className="w-80 max-w-[calc(100vw-2rem)] overscroll-contain p-0"
					>
						<div className="border-b px-3 py-2.5">
							<h2 className="text-sm font-medium text-balance">
								{t("chat.sessionConfig")}
							</h2>
							<p className="mt-0.5 text-pretty text-xs text-muted-foreground">
								{t("chat.sessionConfigDescription")}
							</p>
						</div>
						<div className="max-h-80 space-y-3 overflow-y-auto overscroll-contain p-3">
							{remainingOptions.map((option) => {
								const categoryKey = option.category
									? categoryTranslationKeys[option.category]
									: undefined;
								return option.type === "boolean" ? (
									<ConfigBoolean
										key={option.id}
										option={option}
										categoryLabel={t(
											categoryKey ?? "chat.sessionConfigCategoryOther",
										)}
										disabled={disabled || pendingConfigId !== undefined}
										onChange={(value) => onChange(option.id, value)}
									/>
								) : (
									<ConfigSelectRow
										key={option.id}
										option={option}
										categoryLabel={t(
											categoryKey ?? "chat.sessionConfigCategoryOther",
										)}
										disabled={disabled || pendingConfigId !== undefined}
										onChange={(value) => onChange(option.id, value)}
									/>
								);
							})}
						</div>
					</PopoverContent>
				</Popover>
			) : null}
			{pendingConfigId ? (
				<output className="sr-only" aria-live="polite">
					{t("chat.updatingSessionConfig")}
				</output>
			) : null}
		</span>
	);
}
