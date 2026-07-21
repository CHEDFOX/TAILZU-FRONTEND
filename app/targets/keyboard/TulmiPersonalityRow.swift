import UIKit

/// The personality quick-swap row that sits above the keyboard keys.
///
/// Reads its content from `kb.personality.pinned` in the keyboard config
/// (an array of `{ id, name, emoji, tone }` — see backend
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
final class TulmiPersonalityRow: UIView {

  // MARK: - Types

  struct ChipData {
    let id: String
    let name: String
    let emoji: String
    let tone: String
  }

  /// Fires when a chip is tapped. `nil` tone → use the preset's default.
  var onSelect: ((_ presetId: String, _ tone: String?) -> Void)?

  // MARK: - State

  private var chips: [ChipData] = []
  private var activeId: String = ""
  private var accent: UIColor = .white
  private var chipBg: UIColor = UIColor.white.withAlphaComponent(0.09)
  private var chipFg: UIColor = UIColor.white.withAlphaComponent(0.9)

  /// Fast-tone list shown in the long-press sheet. Backend-driven via
  /// `kb.personality.tones` (array of `{ id, label }`) so tones can be
  /// renamed/reordered/extended with no app update; falls back to the built-in
  /// five so the sheet always has data.
  private var tones: [(id: String, label: String)] = [
    ("none", "None · raw"),
    ("formal", "Formal"),
    ("casual", "Casual"),
    ("very-casual", "Very Casual"),
    ("excited", "Excited"),
  ]

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
    stack.spacing = 6
    stack.translatesAutoresizingMaskIntoConstraints = false
    stack.isLayoutMarginsRelativeArrangement = true
    stack.layoutMargins = UIEdgeInsets(top: 4, left: 8, bottom: 4, right: 8)
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: trailingAnchor),
      stack.topAnchor.constraint(equalTo: topAnchor),
      stack.bottomAnchor.constraint(equalTo: bottomAnchor),
      heightAnchor.constraint(equalToConstant: 36),
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
    if let tones = tones, !tones.isEmpty { self.tones = tones }
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
    b.setTitle("\(chip.emoji) \(chip.name)", for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 12, weight: .semibold)
    b.contentEdgeInsets = UIEdgeInsets(top: 5, left: 10, bottom: 5, right: 10)
    b.layer.cornerRadius = 14
    b.clipsToBounds = true
    b.tag = chipButtons.count // used as an index in gesture handlers

    let isActive = chip.id == activeId
    b.backgroundColor = isActive ? accent.withAlphaComponent(0.9) : chipBg
    b.setTitleColor(isActive ? readableOn(color: accent) : chipFg, for: .normal)

    // Tap = switch. Bind by index so the same button carries both handlers.
    b.addTarget(self, action: #selector(chipTapped(_:)), for: .touchUpInside)

    // Long-press = tone popover.
    let lp = UILongPressGestureRecognizer(target: self, action: #selector(chipLongPressed(_:)))
    lp.minimumPressDuration = 0.35
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
    container.backgroundColor = UIColor(white: 0.09, alpha: 0.96)
    container.layer.cornerRadius = 12
    container.layer.shadowColor = UIColor.black.cgColor
    container.layer.shadowOpacity = 0.35
    container.layer.shadowRadius = 12
    container.layer.shadowOffset = CGSize(width: 0, height: 6)
    container.translatesAutoresizingMaskIntoConstraints = false

    let vstack = UIStackView()
    vstack.axis = .vertical
    vstack.spacing = 2
    vstack.translatesAutoresizingMaskIntoConstraints = false
    vstack.isLayoutMarginsRelativeArrangement = true
    vstack.layoutMargins = UIEdgeInsets(top: 6, left: 6, bottom: 6, right: 6)
    container.addSubview(vstack)
    NSLayoutConstraint.activate([
      vstack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      vstack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      vstack.topAnchor.constraint(equalTo: container.topAnchor),
      vstack.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])

    for tone in tones {
      let btn = UIButton(type: .system)
      btn.setTitle(tone.label, for: .normal)
      btn.setTitleColor(.white, for: .normal)
      btn.titleLabel?.font = .systemFont(ofSize: 13, weight: .medium)
      btn.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
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
    NSLayoutConstraint.activate([
      container.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: max(8, anchorFrame.minX)),
      container.bottomAnchor.constraint(equalTo: host.topAnchor, constant: anchorFrame.minY - 6),
      container.widthAnchor.constraint(greaterThanOrEqualToConstant: 150),
    ])
    popover = container

    // 3) Suction pop: the sheet is "sucked out" of the chip — it starts as a tiny
    // point sitting on the chip and springs up to full size. Lay out first so the
    // scale pivots around real geometry, then set the compressed start transform.
    host.layoutIfNeeded()
    container.alpha = 0
    container.transform = CGAffineTransform(translationX: 0, y: 14).scaledBy(x: 0.06, y: 0.06)

    UIView.animate(withDuration: 0.16) { blur.effect = UIBlurEffect(style: .systemThinMaterialDark) }
    UIView.animate(
      withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.72, initialSpringVelocity: 0.6,
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
    UIView.animate(
      withDuration: 0.2, delay: 0, options: [.curveEaseIn],
      animations: {
        popover?.alpha = 0
        popover?.transform = CGAffineTransform(translationX: 0, y: 14).scaledBy(x: 0.06, y: 0.06)
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
    var v: UIView? = self
    while let cur = v {
      if cur.bounds.height > 120 { return cur }
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
    return lum > 0.55 ? .black : .white
  }
}
