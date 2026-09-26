// A compile-only stand-in for the slice of ExpoModulesCore that
// app/modules/tulmi-bridge/ios/TulmiBridgeModule.swift uses, so CI can
// type-check the bridge module without CocoaPods. Never shipped.
//
// The declarations mirror expo-modules-core's own (Module is the same
// protocol composition, Function takes the same parameter-pack closure with
// the same AnyArgument constraint), so a body that type-checks here
// type-checks against the real pod. Argument types are limited to the ones
// the real AnyArgument covers that the bridge actually uses.
import Foundation

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

public final class AppContext {}

public protocol AnyModule: AnyObject {
  init(appContext: AppContext)
  @ModuleDefinitionBuilder
  func definition() -> ModuleDefinition
}

open class BaseModule {
  public let appContext: AppContext
  public required init(appContext: AppContext) { self.appContext = appContext }
}

public typealias Module = AnyModule & BaseModule

struct NamedDefinition: AnyDefinition {}
struct FunctionDefinition: AnyDefinition {}

public func Name(_ name: String) -> AnyDefinition { NamedDefinition() }

public func Function<R>(
  _ name: String,
  @_implicitSelfCapture _ closure: @escaping () throws -> R
) -> AnyDefinition { FunctionDefinition() }

public func Function<R, A0: AnyArgument, each A: AnyArgument>(
  _ name: String,
  @_implicitSelfCapture _ closure: @escaping (A0, repeat each A) throws -> R
) -> AnyDefinition { FunctionDefinition() }
