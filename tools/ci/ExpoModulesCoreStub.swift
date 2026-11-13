// A compile-only stand-in for the slice of ExpoModulesCore that
// app/modules/tulmi-bridge/ios/TulmiBridgeModule.swift and
// app/modules/tulmi-perms/ios/TulmiPermsModule.swift use, so CI can type-check
// both without CocoaPods. Never shipped.
//
// The declarations mirror expo-modules-core's own (Module is the same
// protocol composition, Function takes the same parameter-pack closure with
// the same AnyArgument constraint), so a body that type-checks here
// type-checks against the real pod. Argument types are limited to the ones
// the real AnyArgument covers that the bridge actually uses.
import Foundation
#if canImport(UIKit)
import UIKit
#endif

public protocol AnyArgument {}
extension String: AnyArgument {}
extension Bool: AnyArgument {}
extension Double: AnyArgument {}
extension Float: AnyArgument {}
extension Int: AnyArgument {}
extension Optional: AnyArgument where Wrapped: AnyArgument {}
extension Array: AnyArgument {}
extension Dictionary: AnyArgument where Key == String {}

public protocol AnyDefinition {}

public struct ModuleDefinition {
  init(definitions: [AnyDefinition]) {}
}

@resultBuilder
public struct ModuleDefinitionBuilder {
  public static func buildBlock(_ definitions: AnyDefinition...) -> ModuleDefinition {
    ModuleDefinition(definitions: definitions)
  }
}

#if canImport(UIKit)
/// Looking up the screen a module may present on (Utilities/Utilities.swift).
public final class Utilities {
  public func currentViewController() -> UIViewController? { nil }
}
#endif

public final class AppContext {
  #if canImport(UIKit)
  public var utilities: Utilities? = Utilities()
  #endif
}

/// What an AsyncFunction answers with (Core/Promise.swift). Resolving with nothing is `null`.
public final class Promise {
  public func resolve(_ value: Any? = nil) {}
  public func reject(_ error: Error) {}
  public func reject(_ code: String, _ description: String) {}
}

public protocol AnyModule: AnyObject {
  init(appContext: AppContext)
  @ModuleDefinitionBuilder
  func definition() -> ModuleDefinition
}

open class BaseModule {
  // Weak and optional, exactly as Core/Modules/Module.swift has it, so a body
  // that writes appContext?.something here needs the same `?` against the pod.
  public private(set) weak var appContext: AppContext?
  public required init(appContext: AppContext) { self.appContext = appContext }
  /// Sends an event to JavaScript listeners (Module.swift).
  public func sendEvent(_ eventName: String, _ body: [String: Any?] = [:]) {}
}

public typealias Module = AnyModule & BaseModule

struct NamedDefinition: AnyDefinition {}
struct FunctionDefinition: AnyDefinition {}
struct EventListener: AnyDefinition {}

public func Name(_ name: String) -> AnyDefinition { NamedDefinition() }

/// A lifecycle hook, called once the module has been created.
public func OnCreate(@_implicitSelfCapture _ closure: @escaping () -> Void) -> AnyDefinition { EventListener() }

public func Function<R>(
  _ name: String,
  @_implicitSelfCapture _ closure: @escaping () throws -> R
) -> AnyDefinition { FunctionDefinition() }

public func Function<R, A0: AnyArgument, each A: AnyArgument>(
  _ name: String,
  @_implicitSelfCapture _ closure: @escaping (A0, repeat each A) throws -> R
) -> AnyDefinition { FunctionDefinition() }

/// The async half (Core/Functions): the closure's last argument may be a Promise, and it
/// runs off the JavaScript thread, so anything touching UIKit dispatches to main itself.
public func AsyncFunction(
  _ name: String,
  @_implicitSelfCapture _ closure: @escaping (Promise) -> Void
) -> AnyDefinition { FunctionDefinition() }

public func AsyncFunction<A0: AnyArgument>(
  _ name: String,
  @_implicitSelfCapture _ closure: @escaping (A0, Promise) -> Void
) -> AnyDefinition { FunctionDefinition() }

public func AsyncFunction<R>(
  _ name: String,
  @_implicitSelfCapture _ closure: @escaping () throws -> R
) -> AnyDefinition { FunctionDefinition() }

struct EventsDefinition: AnyDefinition {}
struct EventObservingDefinition: AnyDefinition {}

/// The events the module may send (ObjectFactories.swift).
public func Events(_ names: String...) -> AnyDefinition { EventsDefinition() }

/// Called when JavaScript starts / stops listening (ObjectFactories.swift).
public func OnStartObserving(_ event: String? = nil, @_implicitSelfCapture _ closure: @escaping () -> Void) -> AnyDefinition { EventObservingDefinition() }
public func OnStopObserving(_ event: String? = nil, @_implicitSelfCapture _ closure: @escaping () -> Void) -> AnyDefinition { EventObservingDefinition() }

#if canImport(UIKit)
/// An app delegate subscriber (AppDelegates/ExpoAppDelegateSubscriber.swift): a UIResponder that is a UIApplicationDelegate,
/// registered by name in expo-module.config.json's appDelegateSubscribers.
@objc(EXBaseAppDelegateSubscriber)
open class BaseExpoAppDelegateSubscriber: UIResponder {
  public override required init() { super.init() }
}

@objc(EXAppDelegateSubscriberProtocol)
public protocol ExpoAppDelegateSubscriberProtocol: UIApplicationDelegate {}

public typealias ExpoAppDelegateSubscriber = BaseExpoAppDelegateSubscriber & ExpoAppDelegateSubscriberProtocol
#endif
