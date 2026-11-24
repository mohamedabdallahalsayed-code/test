#pragma once
// Composite Pattern: RepoNode (abstract) -> FileNode (leaf) / DirectoryNode (composite)
#include <algorithm>
#include <cctype>
#include <memory>
#include <string>
#include <utility>
#include <vector>

class RepoNode {
public:
    virtual ~RepoNode() = default;
    virtual std::string getName() const = 0;
    virtual bool isDirectory() const = 0;
};

class FileNode : public RepoNode {
public:
    FileNode(std::string path, std::string sha, std::string mode)
        : path_(std::move(path)),
          sha_(std::move(sha)),
          mode_(std::move(mode)),
          extension_(extractExtension(path_)) {}

    std::string getName() const override { return path_; }
    bool isDirectory() const override { return false; }

    const std::string& getPath() const { return path_; }
    const std::string& getSha() const { return sha_; }
    const std::string& getMode() const { return mode_; }
    // lowercase, without the dot ("" when there is no dot)
    const std::string& getExtension() const { return extension_; }

private:
    static std::string extractExtension(const std::string& p) {
        const auto dot = p.find_last_of('.');
        if (dot == std::string::npos) return "";
        std::string ext = p.substr(dot + 1);
        std::transform(ext.begin(), ext.end(), ext.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        return ext;
    }

    std::string path_, sha_, mode_, extension_;
};

class DirectoryNode : public RepoNode {
public:
    explicit DirectoryNode(std::string name) : name_(std::move(name)) {}

    std::string getName() const override { return name_; }
    bool isDirectory() const override { return true; }

    void add(std::unique_ptr<RepoNode> child) { children_.push_back(std::move(child)); }
    const std::vector<std::unique_ptr<RepoNode>>& children() const { return children_; }

private:
    std::string name_;
    std::vector<std::unique_ptr<RepoNode>> children_;
};
