type ClientRootMounts = {
	render: () => void;
	hydrate: () => void;
};

export const mountClientRoot = (
	root: HTMLElement,
	mounts: ClientRootMounts,
): void => {
	if (root.hasChildNodes()) {
		mounts.hydrate();
		return;
	}
	mounts.render();
};
