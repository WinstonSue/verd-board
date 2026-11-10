# @sue/verd-board-docs

## 2.1.0

### Minor Changes

- b06ca40: Publish native project documentation and pattern workspaces as independently versioned npm resources. Desktop checks compatible releases using local npm credentials, reminds without downloading, and prepares verified exact versions before the existing backed-up atomic replacement. Keep offline recovery and project identity intact.
- Prepare the application, SDK, UI and Agent together as 2.1.0 for this explicitly authorized early-stage release. This release includes the breaking API changes documented below; existing 2.0 consumers must follow the migration guide. Future releases retain the existing version rules. Local version preparation does not establish npm registry publication.

### Patch Changes

- b06ca40: Remove deprecated CellIndex.membersOf: use groupOf for group membership and domainOwnerOf for domain ownership. Preserve combined lookup precedence with parentOf, domainOwnerOf, then groupOf. Remove legacyThemeColors and the ignored fifth resolveThemeColor argument; use the four-argument resolver and explicit custom color sources. Replace the UI WorkspaceId alias with EditorKind.

  Remove unused internal code and attachment scans, route Keep both through the registered workspace.resolve-conflict action, and synchronize bundled native project documentation and independent content release guidance.

## 0.1.0

Independent native documentation resources.
