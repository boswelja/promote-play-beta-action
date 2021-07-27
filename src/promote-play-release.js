import { getInput, setFailed, exportVariable, debug, info } from '@actions/core';
import { google } from 'googleapis';
import { writeFileSync, unlinkSync } from 'fs';

const serviceAccountFile = "./serviceAccountJson.json";

export async function run() {
  try {
    // Get inputs
    const packageName = getInput('package-name', { required: true });
    const rawServiceAccountJson = getInput('service-account-json-raw', { required: true });
    const inAppUpdatePriorityInput = getInput('inapp-update-priority');
    const userFractionInput = getInput('user-fraction');
    
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
    const authClient = getAuthClient();

    // Create app edit
    info('Creating a new edit');
    const appEdit = await publisher.edits.insert({
      packageName: packageName,
      auth: authClient
    });

    // Get the current beta track
    const prodReleases = mapBetaToProduction(authClient, appEdit.data.id, packageName);

    // Patch beta track to production and apply userFraction and inAppUpdatePriority to the release
    info('Switching beta release to production');
    await publisher.edits.tracks.update({
      auth: authClient,
      editId: appEdit.data.id,
      track: 'production',
      packageName: packageName,
      requestBody: {
        track: 'production',
        releases: prodReleases
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

    info('Successfully promoted release to production');
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
  exportVariable("GOOGLE_APPLICATION_CREDENTIALS", serviceAccountFile);
}

async function mapBetaToProduction(authClient, editId, packageName) {
  info('Getting current beta info');
  const betaTrack = await publisher.edits.tracks.get({
    auth: authClient,
    packageName: packageName,
    editId: editId,
    track: 'beta'
  });
  debug('Mapping beta releases to production releases with new data')
  const betaReleases = betaTrack.data.releases;
  return betaReleases.map((release) => {
    release.inAppUpdatePriority = inAppUpdatePriority;
    release.userFraction = userFraction;
    return release;
  });
}
