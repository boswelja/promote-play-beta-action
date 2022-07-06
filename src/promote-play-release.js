import { getInput, setFailed, exportVariable, debug, info } from '@actions/core';
import { google } from 'googleapis';
import { writeFileSync, unlinkSync, realpathSync } from 'fs';

let serviceAccountFile = "./serviceAccountJson.json";

export async function run() {
  try {
    // Get inputs
    const packageName = getInput('package-name', { required: true });
    const rawServiceAccountJson = getInput('service-account-json-raw', { required: true });
    const inAppUpdatePriorityInput = getInput('inapp-update-priority');
    const userFractionInput = getInput('user-fraction');
    const fromTrack = getInput('from-track');
    const toTrack = getInput('to-track');
    
    // Convert inputs to the correct types
    let userFraction;
    if (userFractionInput) {
      userFraction = parseFloat(userFractionInput);
      debug(`Parsed userFraction: ${userFraction}`);
    }
    let inAppUpdatePriority;
    if (inAppUpdatePriorityInput) {
      inAppUpdatePriority = parseInt(inAppUpdatePriorityInput);
      debug(`Parsed inAppUpdatePriority: ${inAppUpdatePriority}`);
    }

    // Write service account JSON to file, then set the proper env variable so auth can find it.
    storeServiceAccountJson(rawServiceAccountJson);

    // Get publisher
    const publisher = google.androidpublisher('v3');

    // Authenticate
    const authClient = await getAuthClient();

    // Create app edit
    info('Creating a new edit');
    const appEdit = await publisher.edits.insert({
      packageName: packageName,
      auth: authClient
    });

    // Get the current source track, apply userFraction and inAppUpdatePriority to the release
    const toTrackReleases = mapSourceToTargetTrack(authClient, appEdit.data.id, packageName, fromTrack);

    // Patch source track to target
    info(`Switching ${fromTrack} release to ${toTrack}, fraction ${userFraction} priority ${inAppUpdatePriority}`);
    await publisher.edits.tracks.update({
      auth: authClient,
      editId: appEdit.data.id,
      track: toTrack,
      packageName: packageName,
      requestBody: {
        track: toTrack,
        releases: toTrackReleases
      }
    });

    // Commit the changes
    info('Committing changes');
    const commitResult = await publisher.edits.commit({
      auth: authClient,
      editId: appEdit.data.id,
      packageName: packageName
    });

    // Check commit was successful
    if (!commitResult.data.id) {
      setFailed(`Error ${commitResult.status}: ${commitResult.statusText}`);
      return;
    }

    info(`Successfully promoted release to ${toTrack}`);
  } catch (error) {
    setFailed(error);
  }
}

export async function cleanup() {
  unlinkSync(serviceAccountFile);
}

async function getAuthClient() {
  debug('Creating auth client');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  });
  return await auth.getClient();
}

async function storeServiceAccountJson(rawJson) {
  debug('Saving service account JSON for temporary use');
  writeFileSync(serviceAccountFile, rawJson, {
    encoding: 'utf8'
  });

  serviceAccountFile = realpathSync(serviceAccountFile);
  exportVariable("GOOGLE_APPLICATION_CREDENTIALS", serviceAccountFile);
}

async function mapSourceToTargetTrack(authClient, editId, packageName, sourceTrackName) {
  info(`Getting current ${sourceTrackName} info`);
  const sourceTrack = await publisher.edits.tracks.get({
    auth: authClient,
    packageName: packageName,
    editId: editId,
    track: sourceTrackName
  });

  debug(`Mapping ${sourceTrackName} releases to target releases with new data`)
  const sourceReleases = sourceTrack.data.releases;
  return sourceReleases.map((release) => {
    release.inAppUpdatePriority = inAppUpdatePriority;
    release.userFraction = userFraction;
    return release;
  });
}
