/**
 * Avatar storage utilities for production S3 hosting.
 * Non-production callers will receive null (no-op).
 */

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { log } from "@/utils/misc/logger";

type AvatarUploadOptions = {
	personaId: number;
	serverDiscId?: string;
	label?: string;
	buffer: Buffer;
};

type AvatarStorageConfig = {
	bucket: string;
	region: string;
	prefix: string;
	publicBaseUrl: string;
};

const IS_PRODUCTION = process.env.RUN_ENV === "production";
let cachedClient: S3Client | null = null;
let cachedRegion: string | null = null;

function getAvatarStorageConfig(): AvatarStorageConfig | null {
	if (!IS_PRODUCTION) {
		return null;
	}

	const bucket = process.env.AVATAR_S3_BUCKET?.trim();
	if (!bucket) {
		log.warn(
			"[Avatar Storage] AVATAR_S3_BUCKET is missing; falling back to Discord CDN URLs.",
		);
		return null;
	}

	const region =
		process.env.AVATAR_S3_REGION?.trim() ||
		process.env.AWS_REGION?.trim() ||
		"us-east-1";
	const prefix = (process.env.AVATAR_S3_PREFIX || "avatars")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
	const publicBaseUrl =
		process.env.AVATAR_PUBLIC_BASE_URL?.trim() ||
		`https://${bucket}.s3.${region}.amazonaws.com`;

	return {
		bucket,
		region,
		prefix,
		publicBaseUrl,
	};
}

function getS3Client(region: string): S3Client {
	if (!cachedClient || cachedRegion !== region) {
		cachedRegion = region;
		cachedClient = new S3Client({ region });
	}
	return cachedClient;
}

function buildAvatarObjectKey(
	config: AvatarStorageConfig,
	options: AvatarUploadOptions,
): string {
	const timestamp = Date.now();
	const serverSegment = options.serverDiscId
		? `servers/${options.serverDiscId}`
		: "servers/unknown";
	return `${config.prefix}/${serverSegment}/personas/${options.personaId}/${timestamp}.png`;
}

function buildPublicUrl(config: AvatarStorageConfig, key: string): string {
	const baseUrl = config.publicBaseUrl.replace(/\/+$/, "");
	return `${baseUrl}/${key}`;
}

function extractKeyFromAvatarUrl(
	config: AvatarStorageConfig,
	url: string,
): string | null {
	try {
		const parsed = new URL(url);
		const baseHost = new URL(config.publicBaseUrl).hostname;
		const hostname = parsed.hostname;
		const path = parsed.pathname.replace(/^\/+/, "");

		if (hostname !== baseHost) {
			const s3Host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
			const s3HostLegacy = `${config.bucket}.s3.amazonaws.com`;
			if (hostname !== s3Host && hostname !== s3HostLegacy) {
				return null;
			}
		}

		if (!path.startsWith(`${config.prefix}/`)) {
			return null;
		}

		return path;
	} catch {
		return null;
	}
}

export async function uploadPersonaAvatarToS3(
	options: AvatarUploadOptions,
): Promise<string | null> {
	const config = getAvatarStorageConfig();
	if (!config) {
		return null;
	}

	const key = buildAvatarObjectKey(config, options);
	const client = getS3Client(config.region);
	const label = options.label ? ` (${options.label})` : "";

	try {
		await client.send(
			new PutObjectCommand({
				Bucket: config.bucket,
				Key: key,
				Body: options.buffer,
				ContentType: "image/png",
				CacheControl: "public, max-age=31536000, immutable",
			}),
		);
		const publicUrl = buildPublicUrl(config, key);
		log.success(
			`[Avatar Storage] Uploaded persona avatar${label} to S3 (${publicUrl})`,
		);
		return publicUrl;
	} catch (error) {
		log.warn(
			`[Avatar Storage] Failed to upload persona avatar${label} to S3`,
			error,
		);
		return null;
	}
}

export async function deletePersonaAvatarFromS3(
	url: string,
): Promise<boolean> {
	const config = getAvatarStorageConfig();
	if (!config) {
		return false;
	}

	const key = extractKeyFromAvatarUrl(config, url);
	if (!key) {
		return false;
	}

	const client = getS3Client(config.region);

	try {
		await client.send(
			new DeleteObjectCommand({
				Bucket: config.bucket,
				Key: key,
			}),
		);
		log.info(`[Avatar Storage] Deleted avatar object ${key}`);
		return true;
	} catch (error) {
		log.warn(`[Avatar Storage] Failed to delete avatar object ${key}`, error);
		return false;
	}
}
