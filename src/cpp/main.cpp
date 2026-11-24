// stdin protocol (tab separated, one record per line):
//   FILE\t<path>\t<sha>\t<mode>
//   README\t<base64>
//   GITIGNORE\t<base64>
// stdout: JSON array of PlannedAction
#include <cstdio>
#include <iostream>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "PlannerEngine.hpp"
#include "RepoNodes.hpp"
#include "Rules.hpp"

static std::string base64Decode(const std::string& in) {
    static const std::string chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    int val = 0, bits = -8;
    for (unsigned char c : in) {
        const auto pos = chars.find(static_cast<char>(c));
        if (pos == std::string::npos) continue;  // skips '=', whitespace
        val = (val << 6) + static_cast<int>(pos);
        bits += 6;
        if (bits >= 0) {
            out.push_back(static_cast<char>((val >> bits) & 0xFF));
            bits -= 8;
        }
    }
    return out;
}

static std::vector<std::string> splitTabs(const std::string& line) {
    std::vector<std::string> parts;
    std::string cur;
    for (char c : line) {
        if (c == '\t') {
            parts.push_back(cur);
            cur.clear();
        } else {
            cur += c;
        }
    }
    parts.push_back(cur);
    return parts;
}

int main() {
    DirectoryNode root("");
    std::optional<std::string> readme, gitignore;

    std::string line;
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        const auto parts = splitTabs(line);
        if (parts.empty()) continue;

        if (parts[0] == "FILE" && parts.size() >= 3) {
            const std::string& path = parts[1];
            if (path.empty() || path.find('/') != std::string::npos) continue;  // root files only
            root.add(std::make_unique<FileNode>(path, parts[2], parts.size() > 3 ? parts[3] : ""));
        } else if (parts[0] == "README" && parts.size() >= 2) {
            readme = base64Decode(parts[1]);
        } else if (parts[0] == "GITIGNORE" && parts.size() >= 2) {
            gitignore = base64Decode(parts[1]);
        }
    }

    const auto engine = CleanupPlannerEngine::withDefaultRules();
    const auto actions = engine.plan(root, readme, gitignore);
    std::cout << CleanupPlannerEngine::toJson(actions) << std::endl;
    return 0;
}
