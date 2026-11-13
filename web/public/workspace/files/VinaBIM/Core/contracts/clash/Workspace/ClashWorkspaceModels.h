#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <vector>

enum class ClashWorkspaceComparisonSide
{
	A = 0,
	B = 1,
	Both = 2
};

enum ClashWorkspaceGeometryMask
{
	ClashWorkspaceGeometrySurface = 1 << 0,
	ClashWorkspaceGeometryLine = 1 << 1,
	ClashWorkspaceGeometryPoint = 1 << 2
};

struct ClashWorkspaceModel
{
	std::wstring sourceModelId;
	std::wstring sourcePath;
	std::wstring canonicalPath;
	// Format token retained alongside typed enums for manifest JSON serialization.
	std::wstring format;
	std::wstring fileFingerprint;
	std::wstring modelName;
	// Baseline ODA SDK runtime seed (26.12). Can be overridden via imported manifests.
	std::wstring importerVersion = L"ODA-26";
	std::wstring identityKind = L"formatSpecificHandle";
	bool identityStable = false;
	ClashWorkspaceComparisonSide comparisonSide = ClashWorkspaceComparisonSide::Both;
	std::wstring sourceUnit = L"importer";
	// Unit scale of the normalized federated scene. Keep this at 1.0 after
	// import so model view, BCF cameras and scene coordinates remain SI metres.
	double metersPerUnit = 1.0;
	// Importer-native scale retained for cross-model ODA tolerance/distance.
	// Same-model/self-clash uses normalized metersPerUnit instead. Persist this
	// value so later cross-model Run operations can reuse VSFX safely.
	double collisionMetersPerUnit = 1.0;
	std::wstring coordinateSystem = L"FEDERATED_METRES";
	std::array<double, 3> origin{ 0.0, 0.0, 0.0 };
	bool hasSharedCoordinates = true;
	std::wstring metadataQuality = L"complete";
	std::array<double, 16> sourceToFederated{
		1.0, 0.0, 0.0, 0.0,
		0.0, 1.0, 0.0, 0.0,
		0.0, 0.0, 1.0, 0.0,
		0.0, 0.0, 0.0, 1.0 };
	bool resilientProfileUsed = false;
};

struct ClashWorkspaceCollisionOptions
{
	// Transitional active-test mirror used by the current worker transport.
	// Workspace schema v2 persists only Selection A vs B tests.
	int comparisonMode = 0;
	// 0 = Hard (default), 1 = Clearance.
	int collisionType = 0;
	int collisionLevel = 2;
	double tolerance = 0.001;
	bool calculateDistance = true;
	bool allowExplicitSelfClash = true;
};

struct ClashWorkspaceSelectionNode
{
	std::wstring sourceModelId;
	std::wstring identity;
	std::wstring identityKind;
	bool identityStable = false;
	std::uint64_t nativeHandle = 0;
	std::wstring category;
	std::wstring family;
	std::wstring type;
	std::wstring displayName;
	std::wstring hierarchyPath;
	unsigned int geometryMask = ClashWorkspaceGeometrySurface;
};

struct ClashWorkspaceModelSelection
{
	std::wstring sourceModelId;
	bool selectAll = false;
	std::vector<std::wstring> selectedIdentities;
};

/**
 * @brief Selection mode enumeration for building the selection tree.
 */
enum class ClashWorkspaceSelectionMode
{
	Standard = 0,    ///< Standard category/family/type hierarchy
	Compact = 1,     ///< Compact source model list
	Sets = 2         ///< Predefined selection sets
};

/**
 * @brief Selection side definition (Side A or Side B) within a clash test.
 */
struct ClashWorkspaceSelectionSide
{
	unsigned int geometryMask = ClashWorkspaceGeometrySurface;
	int selectionMode = 0;
	std::vector<ClashWorkspaceModelSelection> models;
};

/**
 * @brief Clash filtering rules for excluding expected or duplicate clashes.
 */
struct ClashWorkspaceRules
{
	bool ignoreSameElement = false;      ///< Ignore collisions between the same element
	bool ignoreDuplicatePairs = false;   ///< Ignore commutative duplicate pairs (A-B vs B-A)
	bool ignoreSameLevel = false;        ///< Ignore collisions between elements on the same level
	bool ignoreSameGroup = false;        ///< Ignore collisions within the same assembly/group
	bool ignoreSameCategory = false;     ///< Ignore collisions between elements of the same category
	bool ignoreSameAssembly = false;     ///< Ignore collisions within the same composite/assembly
};

/**
 * @brief Configuration for exporting clash detection reports.
 */
struct ClashWorkspaceReportOptions
{
	int format = 0;                      ///< Report format (HTML, Tabular HTML, CSV, Text, XML, BCF 2.1)
	int groupInclude = 2;                ///< Group inclusion mode
	int scope = 0;                       ///< Report scope: 0 = Current Test, 1 = All Tests, 2 = Combined
	bool preserveHighlight = true;       ///< Preserve 3D element highlight in report snapshots
	std::vector<std::wstring> includedStatuses;  ///< List of clash statuses to include (New, Active, ...)
	std::vector<std::wstring> includedContents;  ///< List of content sections to include (Summary, Comments, Viewpoints, ...)
};

/**
 * @brief Complete definition of a single clash test scenario.
 */
struct ClashWorkspaceTest
{
	std::wstring testId;
	std::wstring name;
	std::wstring defaultAssignee;        ///< Default assignee for newly discovered clashes
	std::wstring lastRunTime;            ///< Formatted timestamp of last execution
	ClashWorkspaceCollisionOptions options;
	ClashWorkspaceRules rules;
	ClashWorkspaceSelectionSide selectionA;
	ClashWorkspaceSelectionSide selectionB;
	ClashWorkspaceReportOptions report;
	std::wstring semanticFingerprint;
	bool selectionValid = true;
};

struct ClashWorkspaceResultRow
{
	std::wstring testId;
	std::wstring sourceModelIdA;
	std::wstring sourceModelIdB;
	std::uint64_t nativeHandleA = 0;
	std::uint64_t nativeHandleB = 0;
	std::wstring identityA;
	std::wstring identityB;
	std::wstring identityKindA;
	std::wstring identityKindB;
	std::wstring level;
	bool identityStableA = false;
	bool identityStableB = false;
	double distanceMeters = 0.0;
	std::wstring reviewStatus;
	std::wstring comment;
	std::wstring assignee;
	int priority = 0;
	int clashIndex = 0;                  ///< Stable 1-based clash identifier within the test
	std::wstring groupId;
	std::wstring foundTime;              ///< Formatted timestamp when clash was discovered
	std::wstring approvedBy;             ///< Username who approved the clash
	std::wstring approvedTime;           ///< Timestamp when clash was approved
	std::wstring resolvedBy;             ///< Username or system that resolved the clash
	std::wstring resolvedTime;           ///< Timestamp when clash was resolved
};

struct ClashWorkspaceManifest
{
	int schemaVersion = 3;
	std::wstring workspaceId;
	std::uint64_t sceneGeneration = 1;
	std::wstring primarySourcePath;
	std::wstring sceneHash;
	std::wstring readerVersion;
	int identityMapVersion = 2;
	int selectionCatalogVersion = 1;
	std::wstring semanticFingerprint;
	std::vector<ClashWorkspaceModel> models;
	std::vector<ClashWorkspaceTest> tests;
	std::wstring activeTestId;
	// Transient mirror of the active test options. It is not serialized as an
	// authoritative manifest field and is refreshed when the active test changes.
	ClashWorkspaceCollisionOptions options;
};

struct ClashWorkspacePackage
{
	std::wstring packagePath;
	std::wstring extractedScenePath;
	ClashWorkspaceManifest manifest;
	std::vector<ClashWorkspaceSelectionNode> selectionCatalog;
	std::vector<ClashWorkspaceResultRow> results;
	// Transient host-side freshness state. It is recomputed when a package is
	// opened and is intentionally not persisted as authoritative metadata.
	std::vector<std::wstring> staleSourceModelIds;
};
