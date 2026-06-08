%{
  configs: [
    %{
      name: "default",
      plugins: [{ExSlop, []}],
      checks: [
        {Credo.Check.Refactor.Apply, false}
      ]
    }
  ]
}
