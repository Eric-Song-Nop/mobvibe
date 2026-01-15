export type AutoScrollState = {
	isAtBottom: boolean;
	hasUserScrolled: boolean;
	lastScrollTop: number;
};

type AutoScrollMetrics = {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	threshold: number;
};

type AutoScrollDecision = {
	sessionChanged: boolean;
	hasMessages: boolean;
};

export const createAutoScrollState = (): AutoScrollState => ({
	isAtBottom: true,
	hasUserScrolled: false,
	lastScrollTop: 0,
});

export const updateAutoScrollState = (
	state: AutoScrollState,
	metrics: AutoScrollMetrics,
): AutoScrollState => {
	const distanceToBottom =
		metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
	const isNearBottom = distanceToBottom <= metrics.threshold;
	const isScrollingUp = metrics.scrollTop < state.lastScrollTop;
	const nextHasUserScrolled = state.hasUserScrolled || isScrollingUp;

	return {
		lastScrollTop: metrics.scrollTop,
		isAtBottom: isNearBottom,
		hasUserScrolled:
			isNearBottom && !isScrollingUp ? false : nextHasUserScrolled,
	};
};

export const shouldAutoScroll = (
	state: AutoScrollState,
	decision: AutoScrollDecision,
): boolean => {
	if (!decision.hasMessages) {
		return false;
	}
	if (state.hasUserScrolled) {
		return false;
	}
	if (!decision.sessionChanged && !state.isAtBottom) {
		return false;
	}
	return true;
};
