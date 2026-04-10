cask "aidana" do
  version "0.0.1"
  sha256 "..."

  url "https://github.com/kyr0/aidana/releases/download/v#{version}/Aidana-v#{version}.zip"
  name "Aidana"
  desc "Local AI voice agent"
  homepage "https://github.com/kyr0/aidana"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Require macOS 14.1+ (matches your app's minimum version)
  depends_on macos: ">= :sonoma"

  app "Aidana.app"

  postflight do
    # Remove quarantine to prevent translocation and permission issues
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Aidana.app"],
                   sudo: false
  end

  # Provide helpful installation notes
  caveats <<~EOS
    On first launch, Aidana will download a ~1.2 GB AI models.
    This only happens once and requires an internet connection.
  EOS

  zap trash: [
    "~/Library/Caches/de.aronhomberg.aidana",
    "~/Library/Caches/FluidAudio",
    "~/Library/Preferences/de.aronhomberg.aidana.plist",
  ]
end

