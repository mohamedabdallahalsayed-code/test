#pragma once
#include <algorithm>
#include <cstdio>
#include <memory>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

#include "RepoNodes.hpp"
#include "Rules.hpp"

class CleanupPlannerEngine {
public:
    // Composition: the engine owns its rules and uses them polymorphically.
    void addRule(std::unique_ptr<IOrganizeRule> rule) { rules_.push_back(std::move(rule)); }

    static CleanupPlannerEngine withDefaultRules() {
        CleanupPlannerEngine e;
        e.addRule(std::make_unique<CodeGuardRule>());
        e.addRule(std::make_unique<AssetRule>());
        e.addRule(std::make_unique<DocsRule>());
        return e;
    }

    std::vector<PlannedAction> plan(const DirectoryNode& root,
                                    const std::optional<std::string>& readme,
                                    const std::optional<std::string>& gitignore) const {
        std::vector<PlannedAction> actions;
        std::vector<std::pair<std::string, std::string>> movedImages;
        std::vector<std::string> tempFiles;

        for (const auto& child : root.children()) {
            if (child->isDirectory()) continue;
            const auto& file = static_cast<const FileNode&>(*child);

            if (isTemp(file)) {
                tempFiles.push_back(file.getPath());
                continue;
            }

            for (const auto& rule : rules_) {
                if (rule->protects(file)) break;
                auto action = rule->evaluate(file);
                if (action) {
                    if (action->newPath.rfind("assets/", 0) == 0)
                        movedImages.emplace_back(file.getPath(), action->newPath);
                    actions.push_back(std::move(*action));
                    break;
                }
            }
        }

        if (readme && !readme->empty() && !movedImages.empty()) {
            std::string updated = *readme;
            for (const auto& img : movedImages) updated = rewriteLinks(updated, img.first, img.second);
            if (updated != *readme) {
                PlannedAction a;
                a.type = "CREATE_OR_UPDATE";
                a.newPath = "README.md";
                a.content = updated;
                a.reason = "تحديث روابط الصور في README.md بعد نقلها";
                actions.push_back(std::move(a));
            }
        }

        if (!tempFiles.empty()) {
            const std::string existing = gitignore.value_or("");
            std::vector<std::string> existingLines;
            std::istringstream in(existing);
            for (std::string line; std::getline(in, line);) existingLines.push_back(trim(line));

            std::string toAdd;
            bool any = false;
            for (const auto& f : tempFiles) {
                if (std::find(existingLines.begin(), existingLines.end(), f) == existingLines.end()) {
                    toAdd += f + "\n";
                    any = true;
                }
            }
            if (any) {
                std::string base = existing;
                if (!base.empty() && base.back() != '\n') base += "\n";
                PlannedAction a;
                a.type = "CREATE_OR_UPDATE";
                a.newPath = ".gitignore";
                a.content = base + "# Added by OrbitHub\n" + toAdd;
                a.reason = "إضافة الملفات المؤقتة إلى .gitignore";
                actions.push_back(std::move(a));
            }
        }
        return actions;
    }

    static std::string toJson(const std::vector<PlannedAction>& actions) {
        std::string out = "[";
        for (size_t i = 0; i < actions.size(); ++i) {
            const auto& a = actions[i];
            if (i) out += ",";
            out += "{\"type\":" + quote(a.type);
            if (a.oldPath) out += ",\"oldPath\":" + quote(*a.oldPath);
            out += ",\"newPath\":" + quote(a.newPath);
            if (a.sha) out += ",\"sha\":" + quote(*a.sha);
            if (a.mode) out += ",\"mode\":" + quote(*a.mode);
            if (a.content) out += ",\"content\":" + quote(*a.content);
            out += ",\"reason\":" + quote(a.reason) + "}";
        }
        return out + "]";
    }

private:
    static bool isTemp(const FileNode& f) {
        return f.getPath() == ".DS_Store" || f.getExtension() == "log" || f.getExtension() == "tmp";
    }

    static std::string trim(const std::string& s) {
        const auto b = s.find_first_not_of(" \t\r\n");
        if (b == std::string::npos) return "";
        const auto e = s.find_last_not_of(" \t\r\n");
        return s.substr(b, e - b + 1);
    }

    static std::string escapeRegex(const std::string& s) {
        static const std::string special = R"(.*+?^${}()|[]\/)";
        std::string out;
        for (char c : s) {
            if (special.find(c) != std::string::npos) out += '\\';
            out += c;
        }
        return out;
    }

    static std::string rewriteLinks(const std::string& text, const std::string& from,
                                    const std::string& to) {
        const std::regex re(R"RX((\]\(\s*<?|src\s*=\s*["']|href\s*=\s*["'])(?:\./)?)RX" +
                            escapeRegex(from) + R"RX((?=[>)"'\s#?]))RX");
        std::string safeTo;
        for (char c : to) {
            if (c == '$') safeTo += '$';
            safeTo += c;
        }
        return std::regex_replace(text, re, "$1" + safeTo);
    }

    static std::string quote(const std::string& s) {
        std::string out = "\"";
        for (unsigned char c : s) {
            switch (c) {
                case '"': out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default:
                    if (c < 0x20) {
                        char buf[8];
                        std::snprintf(buf, sizeof buf, "\\u%04x", c);
                        out += buf;
                    } else {
                        out += static_cast<char>(c);  // UTF-8 bytes pass through
                    }
            }
        }
        return out + "\"";
    }

    std::vector<std::unique_ptr<IOrganizeRule>> rules_;
};
