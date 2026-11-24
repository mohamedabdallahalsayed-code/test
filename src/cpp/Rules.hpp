#pragma once
// Strategy Pattern: each IOrganizeRule decides what to do with one root file.
#include <algorithm>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "RepoNodes.hpp"

struct PlannedAction {
    std::string type;  // "MOVE" or "CREATE_OR_UPDATE"
    std::optional<std::string> oldPath;
    std::string newPath;
    std::optional<std::string> sha;
    std::optional<std::string> mode;
    std::optional<std::string> content;
    std::string reason;
};

class IOrganizeRule {
public:
    virtual ~IOrganizeRule() = default;
    virtual std::optional<PlannedAction> evaluate(const FileNode& file) const = 0;
    // true => engine stops evaluating other rules for this file
    virtual bool protects(const FileNode&) const { return false; }
};

// Shared behaviour for "move files with these extensions into a folder"
class MoveByExtensionRule : public IOrganizeRule {
public:
    MoveByExtensionRule(std::vector<std::string> exts, std::string folder, std::string reason)
        : exts_(std::move(exts)), folder_(std::move(folder)), reason_(std::move(reason)) {}

    std::optional<PlannedAction> evaluate(const FileNode& file) const override {
        if (std::find(exts_.begin(), exts_.end(), file.getExtension()) == exts_.end())
            return std::nullopt;
        PlannedAction a;
        a.type = "MOVE";
        a.oldPath = file.getPath();
        a.newPath = folder_ + "/" + file.getPath();
        a.sha = file.getSha();
        if (!file.getMode().empty()) a.mode = file.getMode();
        a.reason = reason_;
        return a;
    }

protected:
    std::vector<std::string> exts_;
    std::string folder_;
    std::string reason_;
};

class AssetRule : public MoveByExtensionRule {
public:
    AssetRule()
        : MoveByExtensionRule({"png", "jpg", "jpeg", "svg", "gif", "webp"}, "assets",
                              "نقل الصورة إلى assets/") {}
};

class DocsRule : public MoveByExtensionRule {
public:
    DocsRule()
        : MoveByExtensionRule({"pdf", "docx", "pptx"}, "docs", "نقل المستند إلى docs/") {}
};

// Never touches source/web files so imports and links never break.
class CodeGuardRule : public IOrganizeRule {
public:
    std::optional<PlannedAction> evaluate(const FileNode&) const override { return std::nullopt; }
    bool protects(const FileNode& file) const override {
        static const std::vector<std::string> kCode = {"cpp", "c",  "h",    "hpp", "ts",
                                                       "js",  "py", "java", "html", "css"};
        return std::find(kCode.begin(), kCode.end(), file.getExtension()) != kCode.end();
    }
};
