#!/usr/bin/env node
// Creates the S3 buckets the local Compose stack expects. Runs from the
// collector image itself (which already ships @aws-sdk/client-s3), so the
// stack needs no separate CLI image such as `minio/mc`.
//
// Re-running is safe — buckets that already exist are left untouched.
//
// Env: S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
//      S3_FORCE_PATH_STYLE ("true"/"false"), S3_INIT_BUCKETS (comma list).

import process from "node:process";
import {
	CreateBucketCommand,
	HeadBucketCommand,
	S3Client,
} from "@aws-sdk/client-s3";

const required = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
	console.error(`[ensure-buckets] missing env: ${missing.join(", ")}`);
	process.exit(1);
}

const buckets = (process.env.S3_INIT_BUCKETS ?? "obs-replays,obs-profiles")
	.split(",")
	.map((name) => name.trim())
	.filter(Boolean);

if (buckets.length === 0) {
	console.error("[ensure-buckets] S3_INIT_BUCKETS resolved to no bucket names");
	process.exit(1);
}

const client = new S3Client({
	endpoint: process.env.S3_ENDPOINT,
	region: process.env.S3_REGION ?? "us-east-1",
	forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
	credentials: {
		accessKeyId: process.env.S3_ACCESS_KEY_ID,
		secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
	},
});

for (const Bucket of buckets) {
	if (await bucketExists(Bucket)) {
		console.log(`[ensure-buckets] ${Bucket} already exists`);
		continue;
	}
	try {
		await client.send(new CreateBucketCommand({ Bucket }));
		console.log(`[ensure-buckets] created ${Bucket}`);
	} catch (err) {
		const code = err?.name ?? err?.Code;
		if (code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists") {
			console.log(`[ensure-buckets] ${Bucket} already exists`);
			continue;
		}
		throw err;
	}
}

async function bucketExists(Bucket) {
	try {
		await client.send(new HeadBucketCommand({ Bucket }));
		return true;
	} catch (err) {
		const status = err?.$metadata?.httpStatusCode;
		if (
			status === 404 ||
			err?.name === "NotFound" ||
			err?.name === "NoSuchBucket"
		) {
			return false;
		}
		throw err;
	}
}
