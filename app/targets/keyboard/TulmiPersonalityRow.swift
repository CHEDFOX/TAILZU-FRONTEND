import UIKit

/// The personality quick-swap row that sits above the keyboard keys.
///
/// Reads its content from `kb.personality.pinned` in the keyboard config
/// (an array of `{ id, name, tone }` — see backend
/// experience/catalog.ts) and highlights the active preset from
/// `kb.personality.activeId`.
///
/// Interactions:
///   • Tap a chip → switch active preset. Fires the caller's onTap so the
///     surrounding controller can update state + let the refine pipeline
///     use the new voice.
///   • Long-press a chip → a small popover appears above it with the four
///     tones (Formal / Casual / Very Casual / Excited). Picking a tone
///     applies it to that preset + closes the popover.
///
/// The row is intentionally lightweight — one UIStackView of pill buttons,
/// no auto-layout gymnastics — because the keyboard extension's memory
/// budget is tight and this component sits above every render.
///
/// Every size, alpha and timing below is a knob (kb.personalityRow.*): the
/// server sends it with the config, and the literal in each call is only what
/// holds before a config has ever arrived. This is the legacy row — the SDUI
/// renderer draws its own when the config turns SDUI on.
final class TulmiPersonalityRow: UIView {

  // MARK: - Types

  struct ChipData {
    let id: String
    let name: String
    let tone: String
  }

  /// Fires when a chip is tapped. `nil` tone → use the preset's default.
  var onSelect: ((_ presetId: String, _ tone: String?) -> Void)?

  // MARK: - State

  private var chips: [ChipData] = []
  private var activeId: String = ""
  private var accent: UIColor = .white
  private var chipBg: UIColor = UIColor.white.withAlphaComponent(
    CGFloat(knobDouble("kb.personalityRow.chipBgAlpha", 0.09)))
  private var chipFg: UIColor = UIColor.white.withAlphaComponent(
    CGFloat(knobDouble("kb.personalityRow.chipFgAlpha", 0.9)))

  /// Fast-tone list shown in the long-press sheet. Backend-driven via
  /// `kb.personality.tones` (array of `{ id, label }`, handed in through
  /// `update`) so tones can be renamed/reordered/extended with no app update.
  private var serverTones: [(id: String, label: String)]?

  /// What the sheet shows when the config carried no tones: the server's
  /// fallback pair of lists (ids and labels, zipped), else the built-in five,
  /// so the sheet always has data.
  private var tones: [(id: String, label: String)] {
    if let serverTones = serverTones, !serverTones.isEmpty { return serverTones }
    let ids = knobStrings("kb.personalityRow.fallbackToneIds", [
      "none", "formal", "casual", "very-casual", "excited",
    ])
    let labels = knobStrings("kb.personalityRow.fallbackToneLabels", [
      "None · raw", "Formal", "Casual", "Very Casual", "Excited",
    ])
    return zip(ids, labels).map { (id: $0.0, label: $0.1) }
  }

  private let stack = UIStackView()
  private var chipButtons: [UIButton] = []
  private var popover: UIView?
  /// Full-keyboard frosted scrim shown behind the tone sheet.
  private var blurOverlay: UIVisualEffectView?

  private let hapticSelect = UISelectionFeedbackGenerator()

  // MARK: - Init

  override init(frame: CGRect) {
    super.init(frame: frame)
    setupStack()
  }

  required init?(coder: NSCoder) { fatalError() }

  private func setupStack() {
    stack.axis = .horizontal
    stack.alignment = .center
    stack.distribution = .fill
    stack.spacing = CGFloat(knobDouble("kb.personalityRow.spacing", 6))
    stack.translatesAutoresizingMaskIntoConstraints = false
    stack.isLayoutMarginsRelativeArrangement = true
    let marginV = CGFloat(knobDouble("kb.personalityRow.marginV", 4))
    let marginH = CGFloat(knobDouble("kb.personalityRow.marginH", 8))
    stack.layoutMargins = UIEdgeInsets(top: marginV, left: marginH, bottom: marginV, right: marginH)
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: trailingAnchor),
      stack.topAnchor.constraint(equalTo: topAnchor),
      stack.bottomAnchor.constraint(equalTo: bottomAnchor),
      heightAnchor.constraint(equalToConstant: CGFloat(knobDouble("kb.personalityRow.height", 36))),
    ])
  }

  // MARK: - Public API

  /// Update the chip list. `activeId` highlights the current selection.
  /// Colors come from the keyboard theme so the row blends with the keys.
  func update(
    chips: [ChipData],
    activeId: String,
    accentColor: UIColor,
    chipBgColor: UIColor,
    chipFgColor: UIColor,
    tones: [(id: String, label: String)]? = nil,
  ) {
    self.chips = chips
    self.activeId = activeId
    self.accent = accentColor
    self.chipBg = chipBgColor
    self.chipFg = chipFgColor
    if let tones = tones, !tones.isEmpty { self.serverTones = tones }
    rebuild()
  }

  // MARK: - Rebuild

  private func rebuild() {
    chipButtons.forEach { $0.removeFromSuperview() }
    chipButtons.removeAll()
    stack.arrangedSubviews.forEach { stack.removeArrangedSubview($0); $0.removeFromSuperview() }

    for chip in chips {
      let b = makeChipButton(chip)
      stack.addArrangedSubview(b)
      chipButtons.append(b)
    }
    // Trailing flexible spacer so the row left-aligns when fewer than 6
    // chips fit — matches the "chip strip" visual identity users know
    // from Grammarly's tone row.
    let spacer = UIView()
    spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
    stack.addArrangedSubview(spacer)
  }

  private func makeChipButton(_ chip: ChipData) -> UIButton {
    let b = UIButton(type: .custom)
    b.setTitle(chip.name, for: .normal)
    b.titleLabel?.font = .systemFont(
      ofSize: CGFloat(knobDouble("kb.personalityRow.chipFontSize", 12)), weight: .semibold)
    let padV = CGFloat(knobDouble("kb.personalityRow.chipPadV", 5))
    let padH = CGFloat(knobDouble("kb.personalityRow.chipPadH", 10))
    b.contentEdgeInsets = UIEdgeInsets(top: padV, left: padH, bottom: padV, right: padH)
    b.layer.cornerRadius = CGFloat(knobDouble("kb.personalityRow.chipRadius", 14))
    b.clipsToBounds = true
    b.tag = chipButtons.count // used as an index in gesture handlers

    let isActive = chip.id == activeId
    let activeAlpha = CGFloat(knobDouble("kb.personalityRow.activeAlpha", 0.9))
    b.backgroundColor = isActive ? accent.withAlphaComponent(activeAlpha) : chipBg
    b.setTitleColor(isActive ? readableOn(color: accent) : chipFg, for: .normal)

    // Tap = switch. Bind by index so the same button carries both handlers.
    b.addTarget(self, action: #selector(chipTapped(_:)), for: .touchUpInside)

    // Long-press = tone popover.
    let lp = UILongPressGestureRecognizer(target: self, action: #selector(chipLongPressed(_:)))
    lp.minimumPressDuration = knobDouble("kb.personalityRow.longPressSec", 0.35)
    b.addGestureRecognizer(lp)

    return b
  }

  // MARK: - Gesture handlers

  @objc private func chipTapped(_ sender: UIButton) {
    let idx = sender.tag
    guard idx >= 0 && idx < chips.count else { return }
    hapticSelect.selectionChanged()
    onSelect?(chips[idx].id, nil)
    // Optimistic active-state flip — the outer controller updates the
    // authoritative state on the config-refetch callback shortly after.
    activeId = chips[idx].id
    rebuild()
  }

  @objc private func chipLongPressed(_ gr: UILongPressGestureRecognizer) {
    guard gr.state == .began, let btn = gr.view as? UIButton else { return }
    let idx = btn.tag
    guard idx >= 0 && idx < chips.count else { return }
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    showTonePopover(anchor: btn, presetId: chips[idx].id)
  }

  // MARK: - Popover

  /// Where the sheet starts and ends: a point sitting on the chip, dropped by
  /// `popDrop` and shrunk to `popScale`.
  private var collapsedTransform: CGAffineTransform {
    let drop = CGFloat(knobDouble("kb.personalityRow.popDrop", 14))
    let scale = CGFloat(knobDouble("kb.personalityRow.popScale", 0.06))
    return CGAffineTransform(translationX: 0, y: drop).scaledBy(x: scale, y: scale)
  }

  private func showTonePopover(anchor: UIButton, presetId: String) {
    dismissPopover(animated: false)

    // Add to the deepest common ancestor we can reach so the sheet + its
    // frosted scrim cover the whole keyboard, not just this row's bounds.
    guard let host = findAncestorForOverlay() else { return }

    // 1) Frost the keyboard behind the sheet. A UIVisualEffectView blur over the
    // full host makes everything behind read as "pushed back"; a tap on it
    // dismisses. This is the "keyboard blurred in the background" the sheet sits
    // over — it fades in alongside the sheet's suction pop.
    let blur = UIVisualEffectView(effect: nil)
    blur.frame = host.bounds
    blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    host.addSubview(blur)
    blur.addGestureRecognizer(
      UITapGestureRecognizer(target: self, action: #selector(handleScrimTap(_:))))
    blurOverlay = blur

    // 2) The tone sheet.
    let container = UIView()
    container.backgroundColor = UIColor(
      white: CGFloat(knobDouble("kb.personalityRow.sheetWhite", 0.09)),
      alpha: CGFloat(knobDouble("kb.personalityRow.sheetAlpha", 0.96)))
    container.layer.cornerRadius = CGFloat(knobDouble("kb.personalityRow.sheetRadius", 12))
    container.layer.shadowColor = UIColor.black.cgColor
    container.layer.shadowOpacity = Float(knobDouble("kb.personalityRow.sheetShadowOpacity", 0.35))
    container.layer.shadowRadius = CGFloat(knobDouble("kb.personalityRow.sheetShadowRadius", 12))
    container.layer.shadowOffset = CGSize(
      width: 0, height: CGFloat(knobDouble("kb.personalityRow.sheetShadowY", 6)))
    container.translatesAutoresizingMaskIntoConstraints = false

    let vstack = UIStackView()
    vstack.axis = .vertical
    vstack.spacing = CGFloat(knobDouble("kb.personalityRow.sheetSpacing", 2))
    vstack.translatesAutoresizingMaskIntoConstraints = false
    vstack.isLayoutMarginsRelativeArrangement = true
    let sheetPad = CGFloat(knobDouble("kb.personalityRow.sheetPadding", 6))
    vstack.layoutMargins = UIEdgeInsets(top: sheetPad, left: sheetPad, bottom: sheetPad, right: sheetPad)
    container.addSubview(vstack)
    NSLayoutConstraint.activate([
      vstack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      vstack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      vstack.topAnchor.constraint(equalTo: container.topAnchor),
      vstack.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])

    let toneFontSize = CGFloat(knobDouble("kb.personalityRow.toneFontSize", 13))
    let tonePadV = CGFloat(knobDouble("kb.personalityRow.tonePadV", 8))
    let tonePadH = CGFloat(knobDouble("kb.personalityRow.tonePadH", 14))
    for tone in tones {
      let btn = UIButton(type: .system)
      btn.setTitle(tone.label, for: .normal)
      btn.setTitleColor(.white, for: .normal)
      btn.titleLabel?.font = .systemFont(ofSize: toneFontSize, weight: .medium)
      btn.contentEdgeInsets = UIEdgeInsets(top: tonePadV, left: tonePadH, bottom: tonePadV, right: tonePadH)
      btn.contentHorizontalAlignment = .leading
      let toneId = tone.id
      btn.addAction(UIAction { [weak self] _ in
        UISelectionFeedbackGenerator().selectionChanged()
        self?.onSelect?(presetId, toneId)
        self?.activeId = presetId
        self?.rebuild()
        self?.dismissPopover(animated: true)
      }, for: .touchUpInside)
      vstack.addArrangedSubview(btn)
    }

    host.addSubview(container)
    let anchorFrame = anchor.convert(anchor.bounds, to: host)
    let edgeMin = CGFloat(knobDouble("kb.personalityRow.sheetEdgeMin", 8))
    let gap = CGFloat(knobDouble("kb.personalityRow.sheetGap", 6))
    NSLayoutConstraint.activate([
      container.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: max(edgeMin, anchorFrame.minX)),
      container.bottomAnchor.constraint(equalTo: host.topAnchor, constant: anchorFrame.minY - gap),
      container.widthAnchor.constraint(
        greaterThanOrEqualToConstant: CGFloat(knobDouble("kb.personalityRow.sheetMinWidth", 150))),
    ])
    popover = container

    // 3) Suction pop: the sheet is "sucked out" of the chip — it starts as a tiny
    // point sitting on the chip and springs up to full size. Lay out first so the
    // scale pivots around real geometry, then set the compressed start transform.
    host.layoutIfNeeded()
    container.alpha = 0
    container.transform = collapsedTransform

    UIView.animate(withDuration: knobDouble("kb.personalityRow.blurInSec", 0.16)) {
      blur.effect = UIBlurEffect(style: .systemThinMaterialDark)
    }
    UIView.animate(
      withDuration: knobDouble("kb.personalityRow.popInSec", 0.42), delay: 0,
      usingSpringWithDamping: CGFloat(knobDouble("kb.personalityRow.popDamping", 0.72)),
      initialSpringVelocity: CGFloat(knobDouble("kb.personalityRow.popVelocity", 0.6)),
      options: [.curveEaseOut, .allowUserInteraction],
      animations: {
        container.alpha = 1
        container.transform = .identity
      })
  }

  @objc private func handleScrimTap(_ gr: UITapGestureRecognizer) {
    dismissPopover(animated: true)
  }

  private func dismissPopover(animated: Bool) {
    let popover = self.popover
    let blur = self.blurOverlay
    self.popover = nil
    self.blurOverlay = nil
    guard animated, popover != nil || blur != nil else {
      popover?.removeFromSuperview()
      blur?.removeFromSuperview()
      return
    }
    // Reverse suction: the sheet collapses back down into the chip as the frost
    // clears.
    let collapsed = collapsedTransform
    UIView.animate(
      withDuration: knobDouble("kb.personalityRow.popOutSec", 0.2), delay: 0, options: [.curveEaseIn],
      animations: {
        popover?.alpha = 0
        popover?.transform = collapsed
        blur?.effect = nil
        blur?.alpha = 0
      },
      completion: { _ in
        popover?.removeFromSuperview()
        blur?.removeFromSuperview()
      })
  }

  private func findAncestorForOverlay() -> UIView? {
    // Walk up until we hit something big enough to render a floating menu.
    let minHeight = CGFloat(knobDouble("kb.personalityRow.overlayMinHeight", 120))
    var v: UIView? = self
    while let cur = v {
      if cur.bounds.height > minHeight { return cur }
      v = cur.superview
    }
    return superview
  }

  // MARK: - Helpers

  /// Simple luminance-based contrast pick. Matches the readableOn helper the
  /// SDUI renderer uses so the chip's active-state text stays legible on any
  /// backend-supplied accent color.
  private func readableOn(color: UIColor) -> UIColor {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    color.getRed(&r, green: &g, blue: &b, alpha: &a)
    let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return lum > CGFloat(knobDouble("kb.personalityRow.contrastThreshold", 0.55)) ? .black : .white
  }
}
