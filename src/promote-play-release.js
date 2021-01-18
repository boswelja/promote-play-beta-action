import { getInput, setFailed, debug, info, warning } from '@actions/core';
import { google } from 'googleapis';

export async function run() {
  try {
    // Get inputs
    const packageName = getInput('package-name', { required: true });
    const rawServiceAccountJson = getInput('service-account-json-raw', { required: true });
    const inAppUpdatePriority = getInput('inapp-update-priority');
    const userFraction = getInput('user-fraction');

    // Authenticate
    debug('Creating auth client');
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/androidpublisher']
    });
    const authClient = await auth.getClient();

    // Create app edit
    info('Creating a new edit');
    const publisher = google.androidpublisher('v3');
    const appEdit = await publisher.edits.insert({
      packageName: packageName,
      auth: authClient
    });

    // Patch beta track to production and apply userFraction and inAppUpdatePriority to the release
    info('Switching beta release to production');
    const promoteResult = await publisher.edits.tracks.patch({
      auth: authClient,
      editId: appEdit.data.id,
      track: 'beta',
      packageName: packageName,
      requestBody: {
        track: 'production',
        releases: [
          {
            userFraction: userFraction,
            inAppUpdatePriority: inAppUpdatePriority
          }
        ]
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