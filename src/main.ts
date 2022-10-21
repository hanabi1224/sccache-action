
import { writeFileSync } from 'fs';
import { Octokit } from "@octokit/rest";
import * as core from '@actions/core';
import * as cache from '@actions/cache';
import { exec } from '@actions/exec';

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export const getAsset = async (releaseName: string, arch: string) => {
	const octokit = new Octokit({
		'auth': process.env.GITHUB_TOKEN,
	});
	const repo = { owner: 'mozilla', repo: 'sccache' };
	const asset = await (async () => {
		if (releaseName === 'latest') {
			let release: any;
			for (var i = 0; i < 30; i++) {
				try {
					release = await octokit.request('GET /repos/{owner}/{repo}/releases/latest', repo);
					break;
				} catch (e) {
					console.log(`Retrying: ${e}`);
					await sleep(30000);
				}
			}
			const asset = release.data.assets.find(
				(asset: any) => new RegExp(`^sccache-v(.*?)-${arch}.tar.gz$`).test(asset.name));
			return asset;
		} else {
			let releases: any;
			for (var i = 0; i < 30; i++) {
				try {
					releases = await octokit.request('GET /repos/{owner}/{repo}/releases', repo);
					break;
				} catch (e) {
					console.log(`Retrying: ${e}`);
					await sleep(30000);
				}
			}
			const release = releases.data.find((release: any) => release.tag_name === releaseName);
			const asset = release.assets.find(
				(asset: any) => new RegExp(`^sccache-${releaseName}-${arch}.tar.gz$`).test(asset.name));
			return asset;
		}
	})();
	return asset;
};

export const download = async (releaseName: string, arch: string) => {
	let name;
	let download_url;
	if (releaseName === 'latest') {
		const asset = await getAsset(releaseName, arch);
		name = asset.name;
		download_url = asset.browser_download_url
	} else {
		name = `sccache-${releaseName}-${arch}.tar.gz`;
		download_url = `https://github.com/mozilla/sccache/releases/download/${releaseName}/${name}`;
	}
	await exec(`curl "${download_url}" -L -o /tmp/sccache.tar.gz`);
	await exec("tar xvf /tmp/sccache.tar.gz -C /tmp");
	await exec(`mv /tmp/${name.replace('.tar.gz', '')} /tmp/sccache`);
	await exec("chmod +x /tmp/sccache/sccache");
	await exec("ln -sf /tmp/sccache/sccache /usr/local/bin/sccache");
};

export const setupRust = async () => {
	await exec(`echo "[build]\nrustc-wrapper = \\"sccache\\"" | tee ~/.cargo/config`)
	writeFileSync(`${process.env.HOME}/.cargo/config`, `[build]\nrustc-wrapper = "sccache"\n`);
};

export const restoreCache = async (restoreKey: string) => {
	const restoredCacheKey = await cache.restoreCache(
		[`${process.env.HOME}/.cache/sccache`, `${process.env.HOME}/Library/Caches/Mozilla.sccache`], restoreKey, [`${restoreKey}-`]);
	if (restoredCacheKey) {
		core.info(`Cache restored from ${restoredCacheKey}.`);
	} else {
		core.info("Cache not found.");
	}
};

export const resetStat = async () => {
	await exec("sccache -z");
};

export const run = async () => {
	try {
		const restoreKey = core.getInput('cache-key');
		console.log(`Using restoreKey: ${restoreKey}`);
		const releaseName = core.getInput('release-name');
		let arch = core.getInput('arch');
		if (!arch) {
			// https://docs.github.com/en/actions/learn-github-actions/environment-variables
			const os = process.env.RUNNER_OS?.toLocaleLowerCase() ?? '';
			if (os.indexOf('linux') >= 0) {
				arch = 'x86_64-unknown-linux-musl';
			} else if (os.indexOf('macos') >= 0) {
				arch = 'x86_64-apple-darwin';
			} else {
				console.log(`Unsupported OS: ${os}`);
			}
		}
		await download(releaseName, arch);
		await setupRust();
		await restoreCache(restoreKey);
		await resetStat();
	} catch (err: any) {
		core.setFailed(err.message);
	}
};

run();

