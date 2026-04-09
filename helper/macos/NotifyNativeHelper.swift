import AppKit
import Foundation
import UserNotifications

private let categoryIdentifier = "io.github.xihuai18.opencode-notify-native.close-only"

private struct Payload {
  let title: String
  let body: String
  let identifier: String
  let thread: String
}

private enum LaunchMode {
  case notify(Payload)
  case idle
}

private enum ParseError: Error {
  case invalidArguments(String)
}

private func writeError(_ message: String) {
  if let data = ("[notify-native-helper] Error: \(message)\n").data(using: .utf8) {
    FileHandle.standardError.write(data)
  }
}

private func parseArguments(_ args: [String]) throws -> LaunchMode {
  guard args.count > 1 else { return .idle }
  guard args[1] == "notify" else {
    throw ParseError.invalidArguments("unsupported command \(args[1])")
  }

  var title = ""
  var body = ""
  var identifier = ""
  var thread = ""
  var index = 2

  while index < args.count {
    let key = args[index]
    guard index + 1 < args.count else {
      throw ParseError.invalidArguments("missing value for \(key)")
    }
    let value = args[index + 1]
    switch key {
    case "--title":
      title = value
    case "--body":
      body = value
    case "--identifier":
      identifier = value
    case "--thread":
      thread = value
    default:
      throw ParseError.invalidArguments("unknown option \(key)")
    }
    index += 2
  }

  guard !identifier.isEmpty else {
    throw ParseError.invalidArguments("--identifier is required")
  }

  if thread.isEmpty { thread = identifier }
  return .notify(Payload(title: title, body: body, identifier: identifier, thread: thread))
}

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  private let center = UNUserNotificationCenter.current()
  private let mode: LaunchMode
  private var idleQuitTask: DispatchWorkItem?

  fileprivate init(mode: LaunchMode) {
    self.mode = mode
    super.init()
    center.delegate = self
    let category = UNNotificationCategory(
      identifier: categoryIdentifier,
      actions: [],
      intentIdentifiers: [],
      options: [.customDismissAction]
    )
    center.setNotificationCategories([category])
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    switch mode {
    case .notify(let payload):
      send(payload)
    case .idle:
      scheduleQuit(after: 3.0)
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let identifier = response.notification.request.identifier
    center.removeDeliveredNotifications(withIdentifiers: [identifier])
    center.removePendingNotificationRequests(withIdentifiers: [identifier])
    completionHandler()
    terminateSoon()
  }

  private func send(_ payload: Payload) {
    center.requestAuthorization(options: [.alert]) { [weak self] granted, error in
      guard let self else { return }
      if let error {
        writeError(error.localizedDescription)
        self.terminateSoon(with: 1)
        return
      }
      guard granted else {
        writeError("notification permission was not granted")
        self.terminateSoon(with: 1)
        return
      }

      self.center.removeDeliveredNotifications(withIdentifiers: [payload.identifier])
      self.center.removePendingNotificationRequests(withIdentifiers: [payload.identifier])

      let content = UNMutableNotificationContent()
      content.title = payload.title
      content.body = payload.body
      content.categoryIdentifier = categoryIdentifier
      content.threadIdentifier = payload.thread

      let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
      let request = UNNotificationRequest(
        identifier: payload.identifier,
        content: content,
        trigger: trigger
      )

      self.center.add(request) { error in
        if let error {
          writeError(error.localizedDescription)
          self.terminateSoon(with: 1)
          return
        }
        self.scheduleQuit(after: 1.0)
      }
    }
  }

  private func scheduleQuit(after delay: TimeInterval) {
    idleQuitTask?.cancel()
    let task = DispatchWorkItem { [weak self] in
      self?.terminateSoon()
    }
    idleQuitTask = task
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: task)
  }

  private func terminateSoon(with code: Int32 = 0) {
    DispatchQueue.main.async {
      NSApp.terminate(nil)
      exit(code)
    }
  }
}

@main
enum NotifyNativeHelperMain {
  static func main() {
    let mode: LaunchMode
    do {
      mode = try parseArguments(CommandLine.arguments)
    } catch ParseError.invalidArguments(let message) {
      writeError(message)
      exit(2)
    } catch {
      writeError(String(describing: error))
      exit(2)
    }

    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    let delegate = AppDelegate(mode: mode)
    app.delegate = delegate
    app.run()
  }
}
