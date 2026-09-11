# Release checklist

## Automated checks

From the repo root:

```sh
npm ci
npm run doctor
npm test
npm run build
npm run release:pack
```

The packaging command writes `releases/replay-<version>.zip` from explicit public inputs. It excludes recordings, environment secrets, research, internal QA, dependencies and build output. Review the archive inventory before attaching it to a GitHub release. Extract the ZIP into a fresh folder and repeat installation there.

GitHub Actions runs the build and test suite on Node 24 across macOS, Ubuntu and Windows after the repo is published. Inspect the actual results before describing a platform as tested.

Dependency security advisories require a separate `npm audit` check with registry access. The release packer's credential-pattern check is a guardrail, not a full security audit. Review the exact files that will be committed. Check the MIT license and third-party notices before publication.

## Manual recording check

Record the OS, browser version, Node version and FFmpeg version for every tested combination. Test with a clean library and no provider key.

- [ ] Install from the README on a machine without the project's existing dependencies.
- [ ] Start Replay and open the printed address.
- [ ] Grant and deny permissions; cancellation should return to usable setup.
- [ ] Record a real screen, camera and microphone clip.
- [ ] Verify system sound where the browser offers it; document unsupported choices.
- [ ] Pause, resume, stop and save. Play the saved recording.
- [ ] Trim, add captions, move the camera and export MP4. Play the actual export.
- [ ] Restart Replay and reopen the saved recording.
- [ ] Verify a recovery draft after an interrupted recording in a disposable test library.
- [ ] Create a local viewer link and confirm it only shows the rendered edit.
- [ ] Back up the library, install the next build in another folder, restore and play it.

Use disposable recordings for interruption tests. Never clear the user's browser storage or live library as part of QA. Synthetic capture tests do not substitute for physical permissions and audio checks.

## Publication

- [ ] Confirm the version and changelog.
- [ ] Confirm the public source inventory contains no personal recordings, keys or private research.
- [ ] Confirm build/test results and document any untested platforms.
- [ ] Complete the manual recording check on at least one target browser/OS combination.
- [ ] Review dependency advisories.
- [ ] Publish the repository and a beta release with the reviewed source ZIP.

Preparing files and running local checks do not publish anything. Public posting is a separate action.
