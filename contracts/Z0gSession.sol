// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title z0gcode Session NFT
/// @notice A minimal ERC-721 that tokenizes a verifiable z0gcode session. Each
/// token records the 0G Storage content root of the session bundle (transcript
/// + provenance), so ownership of an AI work session is provable on 0G Chain.
/// This is an ERC-721-based, ERC-7857-inspired "intelligent session" NFT; it
/// does not implement the full ERC-7857 encrypted-metadata oracle transfer.
contract Z0gSession {
    string public constant name = "z0gcode Session";
    string public constant symbol = "Z0GS";

    uint256 private _next = 1;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operators;
    mapping(uint256 => string) private _uris;
    mapping(uint256 => string) public sessionRoot;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Minted(uint256 indexed tokenId, address indexed to, string root);

    function supportsInterface(bytes4 id) external pure returns (bool) {
        // ERC165, ERC721, ERC721Metadata
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f;
    }

    /// @notice Mint a session token to `to`, recording its 0G Storage `root`.
    function mint(address to, string calldata root, string calldata uri) external returns (uint256 tokenId) {
        require(to != address(0), "zero to");
        tokenId = _next++;
        _owners[tokenId] = to;
        _balances[to] += 1;
        _uris[tokenId] = uri;
        sessionRoot[tokenId] = root;
        emit Transfer(address(0), to, tokenId);
        emit Minted(tokenId, to, root);
    }

    function totalMinted() external view returns (uint256) {
        return _next - 1;
    }

    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "zero owner");
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owners[tokenId];
        require(owner != address(0), "no token");
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "no token");
        return _uris[tokenId];
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        require(msg.sender == owner || _operators[owner][msg.sender], "not authorized");
        _approved[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        require(_owners[tokenId] != address(0), "no token");
        return _approved[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operators[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(to != address(0), "zero to");
        address owner = ownerOf(tokenId);
        require(owner == from, "wrong from");
        require(
            msg.sender == owner || _approved[tokenId] == msg.sender || _operators[owner][msg.sender],
            "not authorized"
        );
        delete _approved[tokenId];
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata) external {
        transferFrom(from, to, tokenId);
    }
}
