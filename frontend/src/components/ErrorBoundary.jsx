import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center" data-testid="error-boundary">
          <h2 className="font-heading text-xl font-semibold text-foreground">Algo deu errado nesta tela</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Ocorreu um erro inesperado ao renderizar esta página. Tente recarregar ou voltar.
          </p>
          <button
            onClick={() => window.location.assign("/")}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            data-testid="error-boundary-home"
          >
            Voltar para o início
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
