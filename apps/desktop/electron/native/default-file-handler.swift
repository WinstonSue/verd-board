import AppKit
import UniformTypeIdentifiers

// Invoked only by the installed app's explicit default-handler action.
guard CommandLine.arguments.count == 2 else { exit(2) }
let application = URL(fileURLWithPath: CommandLine.arguments[1])
Task { @MainActor in
    do {
        for identifier in ["net.daringfireball.markdown", "com.verdboard.canvas"] {
            guard let type = UTType(identifier) else { exit(3) }
            try await NSWorkspace.shared.setDefaultApplication(at: application, toOpen: type)
        }
        exit(0)
    } catch {
        FileHandle.standardError.write(Data(error.localizedDescription.utf8))
        exit(1)
    }
}
RunLoop.main.run()
