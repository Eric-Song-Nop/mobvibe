export type EncryptedPayload = {
	t: "encrypted";
	c: string;
};

export type CryptoKeyPair = {
	publicKey: Uint8Array;
	secretKey: Uint8Array;
};

export type SignedAuthToken = {
	payload: {
		publicKey: string;
		timestamp: string;
	};
	signature: string;
};
